import { describe, expect, it } from 'vitest';

import {
  VersionConflictError,
  commitIntentPatch,
  createInitialState,
  transitionProjectPhase,
} from '../src/server/runtime/projectState.js';
import { ArtifactSchema, ProjectPhaseSchema, TaskTraceSchema } from '../src/shared/schemas.js';

const brief = {
  product: '低糖气泡咖啡',
  audience: '大学生',
  platform: 'douyin',
  duration: 15,
};

describe('versioned project state', () => {
  it('creates the first committed state at version 1', () => {
    const state = createInitialState(brief);
    expect(state.version).toBe(1);
    expect(state.brief).toEqual(brief);
    expect(state.scenes).toEqual([]);
    expect(state.phase).toBe('BRIEFING');
    expect(ProjectPhaseSchema.parse(state.phase)).toBe('BRIEFING');
  });

  it('requires script review before entering production', () => {
    const initial = createInitialState(brief);
    expect(() => transitionProjectPhase(initial, 'PRODUCING')).toThrow(/script review/i);

    const review = { ...initial, phase: 'SCRIPT_REVIEW' as const };
    expect(transitionProjectPhase(review, 'PRODUCING').phase).toBe('PRODUCING');
  });

  it('validates trace references and audio artifacts', () => {
    expect(TaskTraceSchema.parse({ inputs: [], outputs: [], downstream: [], attempt: 1 })).toMatchObject({
      inputs: [],
      outputs: [],
      downstream: [],
      attempt: 1,
    });
    expect(
      ArtifactSchema.parse({
        id: 'audio_mix_v1',
        type: 'audio',
        uri: 'data/artifacts/audio_mix_v1.wav',
        source: 'fallback',
        stateVersion: 1,
        sessionEpoch: 1,
      }).type,
    ).toBe('audio');
  });

  it('commits a patch immutably and reports changed fields', () => {
    const v1 = createInitialState(brief);
    v1.creative.sellingPoint = 'refreshing';
    v1.creative.style = 'youth_ad';
    const before = structuredClone(v1);

    const result = commitIntentPatch(v1, {
      patchId: 'patch_02',
      baseVersion: 1,
      changes: {
        'creative.sellingPoint': 'low_sugar',
        'creative.style': 'campus_vlog',
      },
      userSummary: '不强调提神，突出低糖，并降低广告感',
    });

    expect(result.previous).toEqual(before);
    expect(result.current.version).toBe(2);
    expect(result.current.creative.sellingPoint).toBe('low_sugar');
    expect(result.current.creative.style).toBe('campus_vlog');
    expect(result.changedFields).toEqual([
      'creative.sellingPoint',
      'creative.style',
    ]);
    expect(v1).toEqual(before);
  });

  it('resolves a scene id inside the scenes array for scene-level intent patches', () => {
    const v1 = createInitialState(brief);
    v1.scenes = [
      {
        id: 'scene_3',
        durationSec: 3,
        visualDescription: '产品罐特写',
        source: 'generated_video',
        generationPrompt: 'coffee can closeup',
      },
    ];

    const result = commitIntentPatch(v1, {
      patchId: 'patch_scene_3',
      baseVersion: 1,
      changes: { 'scenes.scene_3.source': 'existing_asset' },
      userSummary: '第三个镜头换真实素材',
    });

    expect(result.current.scenes).toHaveLength(1);
    expect(result.current.scenes[0]).toMatchObject({ id: 'scene_3', source: 'existing_asset' });
    expect(result.changedFields).toEqual(['scenes.scene_3.source']);
    expect(v1.scenes[0]?.source).toBe('generated_video');
  });

  it('rejects a patch created against an older state version', () => {
    const v1 = createInitialState(brief);

    expect(() =>
      commitIntentPatch(v1, {
        patchId: 'stale_patch',
        baseVersion: 0,
        changes: { 'creative.style': 'campus_vlog' },
        userSummary: '改成校园生活记录',
      }),
    ).toThrowError(VersionConflictError);

    try {
      commitIntentPatch(v1, {
        patchId: 'stale_patch',
        baseVersion: 0,
        changes: { 'creative.style': 'campus_vlog' },
        userSummary: '改成校园生活记录',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'VERSION_CONFLICT' });
    }
  });
});
