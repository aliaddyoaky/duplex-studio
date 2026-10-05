import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { ProjectStateSchema } from '../src/shared/schemas.js';
import type { RuntimeEvent } from '../src/shared/events.js';
import {
  createInitialDemoState,
  demoReducer,
  selectMetrics,
  selectStateDiff,
} from '../src/client/state/useDemoStore.js';

const minimalProject = {
  projectId: 'project_test',
  version: 1,
  phase: 'BRIEFING' as const,
  brief: {
    product: '低糖气泡咖啡',
    audience: '大学生',
    platform: 'douyin',
    duration: 15,
  },
  creative: {
    sellingPoint: 'refreshing',
    style: 'youth_ad',
    tone: 'relaxed',
    hook: '',
    rationale: '',
  },
  scenes: [],
  assets: [],
  generatedClips: [],
};

describe('project shell contracts', () => {
  it('accepts the minimal versioned project state', () => {
    const parsed = ProjectStateSchema.parse(minimalProject);
    expect(parsed.version).toBe(1);
    expect(parsed.brief.duration).toBe(15);
  });

  it('rejects a project state whose version is negative', () => {
    const result = ProjectStateSchema.safeParse({ ...minimalProject, version: -1 });
    expect(result.success).toBe(false);
  });

  it('keeps all long-lived provider API keys out of client config', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'super-secret-key',
      GEMINI_LIVE_MODEL: 'gemini-3.8-live',
      GEMINI_VISION_MODEL: 'gemini-3.8-flash',
      DEEPSEEK_API_KEY: 'deepseek-secret-key',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      MINIMAX_API_KEY: 'minimax-secret-key',
      MINIMAX_VIDEO_MODEL: 'MiniMax-H3-Max',
      DEMO_MODE: 'LIVE',
      PORT: '3001',
    });

    expect(config.server.geminiApiKey).toBe('super-secret-key');
    expect(config.server.deepseekApiKey).toBe('deepseek-secret-key');
    expect(config.server.minimaxApiKey).toBe('minimax-secret-key');
    expect(config.client).toEqual({ liveModel: 'gemini-3.8-live', visionModel: 'gemini-3.8-flash' });
    expect(JSON.stringify(config.client)).not.toContain('super-secret-key');
    expect(JSON.stringify(config.client)).not.toContain('deepseek-secret-key');
    expect(JSON.stringify(config.client)).not.toContain('minimax-secret-key');
  });

  it('exposes a healthy runtime endpoint', async () => {
    const response = await request(createApp()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

describe('interview UI reducer', () => {
  it('clears prior-run observability when reset advances the session epoch', () => {
    let state = createInitialDemoState();
    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: { state: minimalProject, tasks: [], artifacts: [], mode: 'REPLAY', sessionEpoch: 1 },
    });
    state = demoReducer(state, {
      type: 'RUNTIME_EVENT',
      event: runtimeEvent(1, 'STALE_RESULT_DROPPED', 10, { taskId: 'old-script' }),
    });

    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: { state: null, tasks: [], artifacts: [], mode: 'REPLAY', sessionEpoch: 2 },
    });

    expect(state.events).toEqual([]);
    expect(state.staleTaskIds).toEqual([]);
    expect(state.previousProjectState).toBeNull();

    state = demoReducer(state, {
      type: 'RUNTIME_EVENT',
      event: runtimeEvent(2, 'STALE_RESULT_DROPPED', 20, { taskId: 'late-old-script' }),
    });
    expect(state.events).toEqual([]);
  });

  it('shows the authoritative v1→v2 state diff and current mode badge', () => {
    const v1 = { ...minimalProject };
    const v2 = {
      ...minimalProject,
      version: 2,
      creative: { ...minimalProject.creative, sellingPoint: 'low_sugar', style: 'campus_vlog' },
    };
    let state = createInitialDemoState();
    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: { state: v1, tasks: [], artifacts: [], mode: 'LIVE', sessionEpoch: 1 },
    });
    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: { state: v2, tasks: [], artifacts: [], mode: 'HYBRID', sessionEpoch: 1 },
    });

    expect(state.snapshot?.mode).toBe('HYBRID');
    expect(selectStateDiff(state)).toEqual(
      expect.arrayContaining([
        { path: 'creative.sellingPoint', before: 'refreshing', after: 'low_sugar' },
        { path: 'creative.style', before: 'youth_ad', after: 'campus_vlog' },
      ]),
    );
  });

  it('projects task transitions and stale results from Runtime events', () => {
    let state = createInitialDemoState();
    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: {
        state: minimalProject,
        tasks: [
          {
            id: 'script',
            type: 'script',
            stateVersion: 1,
            dependencies: [],
            affectedBy: [],
            status: 'pending',
          },
        ],
        artifacts: [],
        mode: 'LIVE',
        sessionEpoch: 1,
      },
    });
    state = demoReducer(state, { type: 'RUNTIME_EVENT', event: runtimeEvent(1, 'TASK_STARTED', 10, { taskId: 'script' }) });
    expect(state.snapshot?.tasks[0]?.status).toBe('running');
    state = demoReducer(state, {
      type: 'RUNTIME_EVENT',
      event: runtimeEvent(2, 'STALE_RESULT_DROPPED', 20, { taskId: 'script', disposition: 'STALE_VERSION' }),
    });
    expect(state.snapshot?.tasks[0]?.status).toBe('stale');
    expect(state.staleTaskIds).toContain('script');
  });

  it('keeps node trace details in snapshots and clears selection on session reset', () => {
    let state = createInitialDemoState();
    state = demoReducer(state, {
      type: 'SNAPSHOT',
      snapshot: {
        state: minimalProject,
        tasks: [{
          id: 'render', type: 'render', stateVersion: 1, dependencies: [], affectedBy: [], status: 'failed',
          trace: {
            inputs: [{ name: 'clips', kind: 'artifact', summary: '4 clips' }],
            outputs: [], downstream: [], durationMs: 42, attempt: 1,
            error: { code: 'FFMPEG', message: 'mix failed', retryable: true },
          },
        }],
        artifacts: [], mode: 'LIVE', sessionEpoch: 1,
      },
    });
    state = demoReducer(state, { type: 'SELECT_TASK', taskId: 'render' });
    expect(state.snapshot?.tasks[0]?.trace?.error?.retryable).toBe(true);
    expect(state.selectedTaskId).toBe('render');
    state = demoReducer(state, { type: 'SNAPSHOT', snapshot: { state: null, tasks: [], artifacts: [], mode: 'LIVE', sessionEpoch: 2 } });
    expect(state.selectedTaskId).toBeNull();
  });

  it('derives latency and reuse metrics from event timestamps rather than constants', () => {
    const events: RuntimeEvent[] = [
      runtimeEvent(1, 'USER_SPEECH_END', 1_000),
      runtimeEvent(2, 'AGENT_RESPONSE_START', 1_250),
      runtimeEvent(3, 'INTENT_PATCH_COMMITTED', 2_000, { existingTasksAtPatch: 4 }),
      runtimeEvent(4, 'TASK_REUSED', 2_010, { taskId: 'product' }),
      runtimeEvent(5, 'TASK_REUSED', 2_020, { taskId: 'asset' }),
      runtimeEvent(6, 'TASK_REUSED', 2_030, { taskId: 'other' }),
      runtimeEvent(7, 'NEW_TASK_GRAPH_STARTED', 2_080),
    ];
    let state = createInitialDemoState();
    for (const event of events) state = demoReducer(state, { type: 'RUNTIME_EVENT', event });

    expect(selectMetrics(state)).toEqual({
      firstResponseMs: 250,
      interruptReactionMs: null,
      replanLatencyMs: 80,
      taskReuseRate: 0.75,
    });
  });
});

function runtimeEvent(
  sequence: number,
  type: RuntimeEvent['type'],
  timestamp: number,
  payload: Record<string, unknown> = {},
): RuntimeEvent {
  return { sequence, type, timestamp, payload, sessionEpoch: 1, stateVersion: 1 };
}
