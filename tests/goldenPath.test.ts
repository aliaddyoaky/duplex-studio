import { describe, expect, it } from 'vitest';

import goldenProject from '../demo/fixtures/golden-project.json';
import { routeSceneSource, searchAssets } from '../src/server/tools/assetSearch.js';
import goldenPlanV2 from '../demo/fixtures/golden-plan-v2.json';
import { CreativePlanSchema, type CreativePlan } from '../src/server/tools/creativeTools.js';
import {
  createCancellationReleasedDelay,
  DemoOrchestrator,
  type ResultDelay,
} from '../src/server/demo/orchestrator.js';
import type { TaskRecord } from '../src/shared/schemas.js';
import type { VideoArtifact, VideoProvider } from '../src/server/providers/videoProvider.js';
import type { RenderInput } from '../src/server/tools/renderPreview.js';

describe('local asset retrieval and scene routing', () => {
  it('finds a product clip for a Chinese planner query', () => {
    expect(searchAssets('低糖气泡咖啡 开罐 气泡 特写', 1)[0]?.id).toBe('coffee_closeup');
  });

  it('ranks the campus product fixture first for a campus product query', () => {
    const matches = searchAssets('campus product', 2);
    expect(matches[0]).toMatchObject({
      id: 'campus_product_coffee',
      type: 'video',
      provenance: 'self-generated demo fixture',
      license: 'self-generated',
    });
    expect(matches[0].score).toBeGreaterThan(0);
  });

  it('reroutes only scene 3 from generated video to an existing asset', () => {
    const original = CreativePlanSchema.parse(goldenPlanV2);
    original.scenes[2].source = 'generated_video';
    original.scenes[2].generationPrompt = 'Generate a product closeup';
    const before = structuredClone(original);

    const updated = routeSceneSource(original, 'scene_3', 'existing_asset');

    expect(updated.scenes[2].source).toBe('existing_asset');
    expect(updated.scenes[2].generationPrompt).toBeUndefined();
    expect(updated.scenes[0]).toEqual(before.scenes[0]);
    expect(updated.scenes[1]).toEqual(before.scenes[1]);
    expect(updated.scenes[3]).toEqual(before.scenes[3]);
    expect(original).toEqual(before);
  });
});

describe('three-turn Golden Path', () => {
  it('can hold one completed v1 result until its cancellation signal releases it', async () => {
    const controller = new AbortController();
    const task: TaskRecord = {
      id: 'script',
      type: 'script',
      stateVersion: 1,
      dependencies: [],
      affectedBy: [],
      status: 'running',
    };
    const delay = createCancellationReleasedDelay({ taskType: 'script', stateVersion: 1 });
    const result = { taskId: 'script', stateVersion: 1, sessionEpoch: 1 };
    const delayed = delay(task, Promise.resolve(result), controller.signal);
    let settled = false;
    void delayed.then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.abort();
    await expect(delayed).resolves.toEqual(result);
  });

  it('holds at script review without calling the video provider', async () => {
    let videoCalls = 0;
    const orchestrator = makeOrchestrator({ onVideoCall: () => videoCalls += 1 });

    const v1 = await orchestrator.createProject(goldenProject.brief);

    expect(v1.version).toBe(1);
    expect(v1.phase).toBe('SCRIPT_REVIEW');
    expect(v1.scenes.find((scene) => scene.id === 'scene_3')?.source).toBe('generated_video');
    expect(videoCalls).toBe(0);

    const turn2 = await orchestrator.applyPatch(goldenProject.turn2Patch);
    expect(turn2.current.phase).toBe('SCRIPT_REVIEW');
    expect(videoCalls).toBe(0);
  });

  it('starts video only after script confirmation and completes the preview', async () => {
    let videoCalls = 0;
    const orchestrator = makeOrchestrator({ onVideoCall: () => videoCalls += 1 });

    await orchestrator.createProject(goldenProject.brief);
    const confirmed = await orchestrator.confirmScript();
    expect(confirmed.phase).toBe('PRODUCING');
    expect(videoCalls).toBe(2);

    await orchestrator.settle();
    const final = orchestrator.snapshot();
    expect(final.state?.phase).toBe('COMPLETED');
    expect(final.state?.preview).toMatchObject({ id: 'preview_v1', stateVersion: 1 });
  });

  it('cancels affected production work when the user changes a scene source', async () => {
    let releaseVideo!: () => void;
    const videoGate = new Promise<void>((resolve) => { releaseVideo = resolve; });
    const orchestrator = makeOrchestrator({
      videoProvider: {
        generate: async (input, signal) => {
          await Promise.race([
            videoGate,
            new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
          ]);
          return {
            id: `generated_${input.stateVersion}`,
            type: 'video',
            uri: 'demo/assets/campus_product_coffee.mp4',
            source: 'live',
            stateVersion: input.stateVersion,
            sessionEpoch: input.sessionEpoch,
          };
        },
      },
    });

    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    const updated = await orchestrator.applyPatch({
      ...goldenProject.turn3Patch,
      baseVersion: 1,
    });
    releaseVideo();
    await orchestrator.settle();

    expect(updated.current.version).toBe(2);
    expect(orchestrator.snapshot().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TASK_CANCELLED', payload: expect.objectContaining({ taskType: 'generated_scene:scene_3' }) }),
      ]),
    );
  });
});

function makeOrchestrator(options: { delayResult?: ResultDelay; videoProvider?: VideoProvider; onVideoCall?: () => void } = {}) {
  let videoIndex = 0;
  const videoProvider: VideoProvider = options.videoProvider ?? {
    generate: async (input) => {
      options.onVideoCall?.();
      return {
        id: `generated_${input.stateVersion}_${++videoIndex}`,
        type: 'video' as const,
        uri: 'demo/assets/campus_product_coffee.mp4',
        source: 'live' as const,
        stateVersion: input.stateVersion,
        sessionEpoch: input.sessionEpoch,
      };
    },
  };
  return new DemoOrchestrator({
    planner: {
      plan: async (state): Promise<CreativePlan> =>
        CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan),
    },
    videoProvider,
    renderPreview: async (input: RenderInput): Promise<VideoArtifact> => ({
      id: input.outputId,
      type: 'video',
      uri: 'demo/assets/campus_walk.mp4',
      source: 'live',
      stateVersion: input.stateVersion,
      sessionEpoch: input.sessionEpoch,
    }),
    delayResult: options.delayResult,
  });
}
