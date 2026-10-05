import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import golden from '../demo/fixtures/golden-project.json';
import { DemoOrchestrator } from '../src/server/demo/orchestrator.js';
import { AssetLibrary } from '../src/server/assets/assetLibrary.js';
import { HistoryStore } from '../src/server/history/historyStore.js';
import { CreativePlanSchema } from '../src/server/tools/creativeTools.js';
import type { ProjectState } from '../src/shared/schemas.js';

async function harness(planner?: ConstructorParameters<typeof DemoOrchestrator>[0]['planner']) {
  const dir = await mkdtemp(join(tmpdir(), 'duplex-regression-'));
  const assets = new AssetLibrary({ storageDir: join(dir, 'uploads'), metadataPath: join(dir, 'library.json') });
  const render = vi.fn(async (input) => ({ id: input.outputId, type: 'video' as const, uri: 'demo/assets/campus_walk.mp4', source: 'live' as const, stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch }));
  const orchestrator = new DemoOrchestrator({
    assetLibrary: assets,
    historyStore: new HistoryStore({ rootDir: join(dir, 'projects') }),
    planner: planner ?? { plan: async () => CreativePlanSchema.parse(golden.initialPlan) },
    videoProvider: { generate: async (input) => ({ id: crypto.randomUUID(), type: 'video', uri: 'demo/assets/campus_walk.mp4', source: 'live', stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch }) },
    renderPreview: render,
    audioProvider: {
      generateVoiceover: async (input) => ({ id: 'voice', type: 'audio', uri: 'voice.wav', source: 'fallback', stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch }),
      selectOrGenerateBgm: async (input) => ({ id: 'bgm', type: 'audio', uri: 'bgm.wav', source: 'fallback', stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch }),
      prepareSfx: async () => [],
    },
  });
  return { orchestrator, assets, render };
}

describe('workflow integration regressions', () => {
  it('passes uploaded assets into the planner and honors an explicit clip selection', async () => {
    const plan = vi.fn(async () => CreativePlanSchema.parse(golden.initialPlan));
    const { orchestrator, assets, render } = await harness({ plan });
    const uploaded = await assets.upload({ filename: 'campus.mp4', mimeType: 'video/mp4', bytes: await readFile('demo/assets/campus_walk.mp4') });
    const state = await orchestrator.createProject(golden.brief);
    const plannerInput = (plan.mock.calls as unknown[][])[0]?.[0] as ProjectState;
    expect(plannerInput.assets).toContainEqual(uploaded);
    await orchestrator.applyPatch({ patchId: 'choose', baseVersion: 1, userSummary: '第二镜头使用上传素材', changes: { 'scenes.scene_2.assetId': uploaded.id, 'scenes.scene_2.source': 'existing_asset' } });
    await orchestrator.confirmScript();
    await orchestrator.settle();
    expect(render.mock.calls[0]?.[0]?.clips[1].artifact.uri).toBe(uploaded.uri);
    expect(state.projectId).not.toBe('project_local');
  });

  it('rejects a late planner response after reset instead of resurrecting the project', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { orchestrator } = await harness({ plan: async () => { await gate; return CreativePlanSchema.parse(golden.initialPlan); } });
    const creation = orchestrator.createProject(golden.brief);
    await new Promise((resolve) => setTimeout(resolve, 20));
    orchestrator.reset();
    release();
    await expect(creation).rejects.toThrow(/superseded|cancel|abort/i);
    expect(orchestrator.snapshot().state).toBeNull();
  });

  it('records actual script outputs, timing, and prompt inputs for planning nodes', async () => {
    const { orchestrator } = await harness();
    await orchestrator.createProject(golden.brief);
    const task = orchestrator.taskDetail('script')?.task;
    expect(task?.trace?.durationMs).toBeTypeOf('number');
    expect(task?.trace?.outputs[0]?.summary).toContain('课间');
    expect(task?.trace?.inputs.some((input) => input.kind === 'prompt')).toBe(true);
  });
});
