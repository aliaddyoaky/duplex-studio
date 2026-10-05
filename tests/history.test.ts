import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { HistoryStore } from '../src/server/history/historyStore.js';
import { DemoOrchestrator } from '../src/server/demo/orchestrator.js';
import { createApp } from '../src/server/app.js';
import goldenProject from '../demo/fixtures/golden-project.json';
import { CreativePlanSchema } from '../src/server/tools/creativeTools.js';

describe('HistoryStore', () => {
  it('writes immutable version snapshots and keeps failed versions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'duplex-history-'));
    const store = new HistoryStore({ rootDir });
    const state = { projectId: 'project_test', version: 1, phase: 'SCRIPT_REVIEW', scenes: [] };
    await store.saveVersion({
      projectId: 'project_test',
      version: 1,
      phase: 'SCRIPT_REVIEW',
      state,
      tasks: [],
      artifacts: [],
      savedAt: '2026-10-05T00:00:00.000Z',
    });
    state.phase = 'FAILED';
    await store.saveVersion({
      projectId: 'project_test',
      version: 2,
      phase: 'FAILED',
      state,
      tasks: [{ id: 'render', status: 'failed', trace: { error: { code: 'FFMPEG', message: 'boom', retryable: true } } }],
      artifacts: [],
      savedAt: '2026-10-05T00:01:00.000Z',
    });

    const first = await store.get('project_test', 1);
    expect(first?.phase).toBe('SCRIPT_REVIEW');
    expect(first?.state).toEqual({ projectId: 'project_test', version: 1, phase: 'SCRIPT_REVIEW', scenes: [] });
    expect(await store.list('project_test')).toEqual([
      { version: 2, phase: 'FAILED', savedAt: '2026-10-05T00:01:00.000Z', taskCount: 1, artifactCount: 0 },
      { version: 1, phase: 'SCRIPT_REVIEW', savedAt: '2026-10-05T00:00:00.000Z', taskCount: 0, artifactCount: 0 },
    ]);
  });

  it('exposes history, confirmation, and task detail routes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'duplex-history-api-'));
    const historyStore = new HistoryStore({ rootDir });
    const orchestrator = new DemoOrchestrator({
      historyStore,
      planner: { plan: async (state) => CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan) },
      videoProvider: {
        generate: async (input) => ({
          id: `clip_${input.stateVersion}`,
          type: 'video' as const,
          uri: 'demo/assets/campus_walk.mp4',
          source: 'live' as const,
          stateVersion: input.stateVersion,
          sessionEpoch: input.sessionEpoch,
        }),
      },
      renderPreview: async (input) => ({
        id: input.outputId,
        type: 'video' as const,
        uri: 'demo/assets/campus_walk.mp4',
        source: 'live' as const,
        stateVersion: input.stateVersion,
        sessionEpoch: input.sessionEpoch,
      }),
      audioProvider: {
        generateVoiceover: async (input) => audio(input.stateVersion, input.sessionEpoch, 'voiceover'),
        selectOrGenerateBgm: async (input) => audio(input.stateVersion, input.sessionEpoch, 'bgm'),
        prepareSfx: async () => [],
      },
    });
    const app = createApp({ demoOrchestrator: orchestrator });
    const created = await request(app).post('/api/project').send(goldenProject.brief);
    expect(created.status).toBe(201);
    expect((await request(app).get('/api/project/history')).body[0]).toMatchObject({ version: 1, phase: 'SCRIPT_REVIEW' });
    expect((await request(app).get('/api/tasks/script')).status).toBe(200);

    const confirmed = await request(app).post('/api/project/confirm-script').send({});
    expect(confirmed.status).toBe(200);
    await orchestrator.settle();
    const version = await request(app).get('/api/project/history/1');
    expect(version.status).toBe(200);
    expect(version.body.state.phase).toBe('COMPLETED');
    expect((await request(app).get('/api/project/history')).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1, phase: 'SCRIPT_REVIEW' }), expect.objectContaining({ version: 1, phase: 'COMPLETED' })]),
    );
  });

  it('retains a failed node and only retries when its trace is retryable', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'duplex-history-retry-'));
    const orchestrator = new DemoOrchestrator({
      historyStore: new HistoryStore({ rootDir }),
      planner: { plan: async (state) => CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan) },
      videoProvider: { generate: async () => { throw Object.assign(new Error('provider down'), { code: 'PROVIDER_DOWN' }); } },
      audioProvider: {
        generateVoiceover: async (input) => audio(input.stateVersion, input.sessionEpoch, 'voiceover'),
        selectOrGenerateBgm: async (input) => audio(input.stateVersion, input.sessionEpoch, 'bgm'),
        prepareSfx: async () => [],
      },
      renderPreview: async (input) => ({ id: input.outputId, type: 'video' as const, uri: 'demo/assets/campus_walk.mp4', source: 'live' as const, stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch }),
    });
    const app = createApp({ demoOrchestrator: orchestrator });
    await request(app).post('/api/project').send(goldenProject.brief);
    await request(app).post('/api/project/confirm-script').send({});
    await orchestrator.settle();

    const failed = await request(app).get('/api/tasks/generate_scene_3');
    expect(failed.body.task.status).toBe('failed');
    expect(failed.body.task.trace.error).toMatchObject({ code: 'PROVIDER_DOWN', retryable: true });
    const retry = await request(app).post('/api/project/retry-task').send({ taskId: 'generate_scene_3' });
    expect(retry.status).toBe(200);
    expect(retry.body.trace.attempt).toBe(2);
  });
});

function audio(stateVersion: number, sessionEpoch: number, id: string) {
  return { id, type: 'audio' as const, uri: 'demo/assets/campus_walk.mp4', source: 'live' as const, stateVersion, sessionEpoch };
}
