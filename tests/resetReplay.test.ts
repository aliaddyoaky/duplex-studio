import request from 'supertest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import goldenProject from '../demo/fixtures/golden-project.json';
import { createApp } from '../src/server/app.js';
import { DemoOrchestrator, type ResultDelay } from '../src/server/demo/orchestrator.js';
import { ReplayCatalog } from '../src/server/demo/replay.js';
import { VideoGenerationError, type VideoArtifact, type VideoProvider } from '../src/server/providers/videoProvider.js';
import { CreativePlanSchema, type CreativePlan } from '../src/server/tools/creativeTools.js';
import type { RenderInput } from '../src/server/tools/renderPreview.js';

const execFileAsync = promisify(execFile);

describe('demo reset and fallback modes', () => {
  it('reset advances sessionEpoch and rejects a late pre-reset result', async () => {
    let releaseLateResult!: () => void;
    const gate = new Promise<void>((resolve) => (releaseLateResult = resolve));
    const delayResult: ResultDelay = async (task, result) => {
      const resolved = await result;
      if (task.stateVersion === 1 && task.type.startsWith('generated_scene:')) await gate;
      return resolved;
    };
    const orchestrator = makeOrchestrator({ delayResult });
    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();

    const reset = orchestrator.reset();
    releaseLateResult();
    await orchestrator.settle();

    const snapshot = orchestrator.snapshot();
    expect(reset).toMatchObject({ sessionEpoch: 2 });
    expect(reset.abortedTasks).toBeGreaterThan(0);
    expect(snapshot.sessionEpoch).toBe(2);
    expect(snapshot.state).toBeNull();
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STALE_RESULT_DROPPED',
          sessionEpoch: 1,
          payload: expect.objectContaining({ disposition: 'STALE_EPOCH' }),
        }),
      ]),
    );
  }, 15_000);

  it('enters visibly marked HYBRID on video failure only when fallback policy allows it', async () => {
    const failingProvider: VideoProvider = {
      generate: async () => {
        throw new VideoGenerationError('VIDEO_GENERATION_TIMEOUT', 'controlled timeout');
      },
    };
    const orchestrator = makeOrchestrator({
      videoProvider: failingProvider,
      allowHybridFallback: true,
      fallbackVideoByScene: fallbackVideos(),
    });

    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    await orchestrator.settle();

    const snapshot = orchestrator.snapshot();
    expect(snapshot.mode).toBe('HYBRID');
    expect(snapshot.artifacts.some((artifact) => artifact.source === 'fallback')).toBe(true);

    const disallowed = makeOrchestrator({
      videoProvider: failingProvider,
      allowHybridFallback: false,
      fallbackVideoByScene: fallbackVideos(),
    });
    await disallowed.createProject(goldenProject.brief);
    await disallowed.confirmScript();
    await disallowed.settle();
    expect(disallowed.snapshot().mode).toBe('LIVE');
    expect(disallowed.snapshot().artifacts.some((artifact) => artifact.source === 'fallback')).toBe(false);
  }, 15_000);

  it('normalizes planner-chosen scene ids so HYBRID fallback always matches', async () => {
    // DeepSeek 会自由命名镜头（s1、scene01 等），兜底映射固定使用 scene_N。
    // 归一化必须让两者重新对齐，否则 402 时 HYBRID 模式会直接失败。
    const planWithFreeSceneIds = (): CreativePlan => {
      const base = structuredClone(goldenProject.initialPlan) as unknown as CreativePlan;
      const remap = new Map<string, string>();
      base.scenes.forEach((scene, index) => {
        const free = `s${index + 1}`;
        remap.set(scene.id, free);
        scene.id = free;
      });
      if (base.script) {
        base.script.shots = base.script.shots.map((shot) => ({ ...shot, id: remap.get(shot.id) ?? shot.id }));
      }
      return base;
    };
    const failingProvider: VideoProvider = {
      generate: async () => {
        throw new VideoGenerationError('VIDEO_OUTPUT_MISSING', 'MiniMax API 402: insufficient balance');
      },
    };
    const orchestrator = makeOrchestrator({
      planner: { plan: async () => planWithFreeSceneIds() },
      videoProvider: failingProvider,
      allowHybridFallback: true,
      fallbackVideoByScene: fallbackVideos(),
    });

    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    await orchestrator.settle();

    const snapshot = orchestrator.snapshot();
    expect(snapshot.state?.scenes.map((scene) => scene.id)).toEqual(['scene_1', 'scene_2', 'scene_3', 'scene_4']);
    expect(snapshot.mode).toBe('HYBRID');
    expect(snapshot.artifacts.some((artifact) => artifact.source === 'fallback')).toBe(true);
    expect(snapshot.state?.phase).not.toBe('FAILED');
  }, 15_000);

  it('REPLAY uses recorded artifacts without calling the live video provider', async () => {
    const liveGenerate = vi.fn<VideoProvider['generate']>();
    const orchestrator = makeOrchestrator({
      videoProvider: { generate: liveGenerate },
      replayCatalog: new ReplayCatalog(goldenProject.replayVideos),
    });
    orchestrator.setMode('REPLAY');

    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    await orchestrator.settle();

    expect(liveGenerate).not.toHaveBeenCalled();
    expect(orchestrator.snapshot()).toMatchObject({ mode: 'REPLAY' });
  });

  it('REPLAY never calls the live planner when provider access is unavailable', async () => {
    const livePlan = vi.fn(async () => { throw new Error('provider quota exhausted'); });
    const replayPlan = vi.fn(async (state): Promise<CreativePlan> =>
      CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan));
    const orchestrator = makeOrchestrator({
      planner: { plan: livePlan },
      replayPlanner: { plan: replayPlan },
      replayCatalog: new ReplayCatalog(goldenProject.replayVideos),
    });
    orchestrator.setMode('REPLAY');

    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    await orchestrator.settle();

    expect(livePlan).not.toHaveBeenCalled();
    expect(replayPlan).toHaveBeenCalledOnce();
    expect(orchestrator.snapshot().state?.version).toBe(1);
  });

  it('replay completes the confirmed workflow with exactly one mixed audio stream', async () => {
    const orchestrator = new DemoOrchestrator({
      planner: { plan: async () => { throw new Error('live planner must not run'); } },
      replayPlanner: { plan: async (state) => CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan) },
      videoProvider: { generate: async () => { throw new Error('live video must not run'); } },
      replayCatalog: new ReplayCatalog(goldenProject.replayVideos),
    });
    orchestrator.setMode('REPLAY');
    await orchestrator.createProject(goldenProject.brief);
    await orchestrator.confirmScript();
    await orchestrator.settle();
    const preview = orchestrator.snapshot().state?.preview;
    expect(preview).toBeTruthy();
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', preview!.uri]);
    const streams = (JSON.parse(stdout) as { streams: Array<{ codec_type: string }> }).streams;
    expect(streams.filter((stream) => stream.codec_type === 'audio')).toHaveLength(1);
  }, 40_000);

  it('exposes project, intent, mode, and reset as Runtime HTTP boundaries', async () => {
    const orchestrator = makeOrchestrator({ replayCatalog: new ReplayCatalog(goldenProject.replayVideos) });
    orchestrator.setMode('REPLAY');
    const app = createApp({ demoOrchestrator: orchestrator });

    await request(app).post('/api/project').send(goldenProject.brief).expect(201);
    const patch = await request(app).post('/api/intent/patch').send(goldenProject.turn2Patch).expect(200);
    expect(patch.body.stateVersion).toBe(2);
    const mode = await request(app).post('/api/demo/mode').send({ mode: 'HYBRID' }).expect(200);
    expect(mode.body.mode).toBe('HYBRID');
    const reset = await request(app).post('/api/demo/reset').expect(200);
    expect(reset.body.sessionEpoch).toBe(2);
  });
});

function makeOrchestrator(options: {
  delayResult?: ResultDelay;
  planner?: ConstructorParameters<typeof DemoOrchestrator>[0]['planner'];
  replayPlanner?: ConstructorParameters<typeof DemoOrchestrator>[0]['replayPlanner'];
  videoProvider?: VideoProvider;
  allowHybridFallback?: boolean;
  fallbackVideoByScene?: Record<string, VideoArtifact>;
  replayCatalog?: ReplayCatalog;
} = {}) {
  let videoIndex = 0;
  const videoProvider: VideoProvider = options.videoProvider ?? {
    generate: async (input) => ({
      id: `live_${++videoIndex}`,
      type: 'video',
      uri: 'demo/assets/campus_product_coffee.mp4',
      source: 'live',
      stateVersion: input.stateVersion,
      sessionEpoch: input.sessionEpoch,
    }),
  };
  return new DemoOrchestrator({
    planner: options.planner ?? {
      plan: async (state): Promise<CreativePlan> =>
        CreativePlanSchema.parse(state.version === 1 ? goldenProject.initialPlan : goldenProject.turn2Plan),
    },
    replayPlanner: options.replayPlanner,
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
    allowHybridFallback: options.allowHybridFallback,
    fallbackVideoByScene: options.fallbackVideoByScene,
    replayCatalog: options.replayCatalog,
  });
}

function fallbackVideos(): Record<string, VideoArtifact> {
  return Object.fromEntries(
    Object.entries(goldenProject.replayVideos).map(([sceneId, uri]) => [
      sceneId,
      { id: `cached_${sceneId}`, type: 'video', uri, source: 'live', stateVersion: 1, sessionEpoch: 1 },
    ]),
  );
}
