import { describe, expect, it } from 'vitest';

import { CreativeBrain } from '../src/server/agents/creativeBrain.js';
import type { ImageProvider } from '../src/server/providers/imageProvider.js';
import type { ReasoningProvider } from '../src/server/providers/reasoningProvider.js';
import { generateImageReferences } from '../src/server/tools/generateImageReference.js';
import { CreativePlanSchema, type CreativePlan } from '../src/server/tools/creativeTools.js';
import { createInitialState } from '../src/server/runtime/projectState.js';

const state = createInitialState({
  product: '低糖气泡咖啡',
  audience: '大学生',
  platform: 'douyin',
  duration: 15,
});
state.creative.sellingPoint = 'low_sugar';
state.creative.style = 'campus_vlog';
state.creative.tone = 'relaxed';

function validPlan(): CreativePlan {
  return {
    constraints: {
      platform: 'douyin',
      sellingPoint: 'low_sugar',
      style: 'campus_vlog',
      duration: 15,
    },
    strategy: {
      hook: '课间也能轻松喝的低糖气泡咖啡',
      rationale: '用校园生活记录弱化广告感',
    },
    script: {
      voiceover: '低糖，也可以很好喝。',
      durationSec: 15,
      language: 'zh-CN',
      compliance: { passed: true, notes: [] },
      audioPlan: {
        bgm: { style: '轻快校园', intensity: '低' },
        soundEffects: [],
        ducking: { voiceoverDb: -3, bgmDb: -16 },
      },
      shots: [],
    },
    scenes: [1, 2, 3, 4].map((index) => ({
      id: `scene_${index}`,
      durationSec: index === 4 ? 6 : 3,
      visualDescription: `Scene ${index}`,
      source: index === 3 ? 'existing_asset' : 'generated_video',
      generationPrompt: index === 3 ? undefined : `Generate scene ${index}`,
      assetQuery: index === 3 ? 'product coffee can' : undefined,
      needsImageReference: index === 1,
    })),
  };
}

describe('System 2 Creative Brain', () => {
  it('accepts structured per-shot audio and source decisions', () => {
    const plan = validPlan();
    plan.script = {
      ...plan.script,
      audioPlan: {
        bgm: { style: '轻快校园', intensity: '低' },
        soundEffects: [{ atSec: 1.5, description: '开罐声' }],
        ducking: { voiceoverDb: -3, bgmDb: -16 },
      },
      shots: plan.scenes.map((scene, index) => ({
        order: index + 1,
        id: scene.id,
        durationSec: scene.durationSec,
        visualDescription: scene.visualDescription,
        sourceDecision: {
          kind: scene.source,
          reason: scene.source === 'existing_asset' ? '素材库命中' : '需要生成新画面',
          candidates: scene.assetQuery ? ['coffee_closeup'] : [],
        },
        existingClip: scene.source === 'existing_asset' ? { assetId: 'coffee_closeup' } : undefined,
        aigcPrompt: scene.generationPrompt,
        voiceover: '低糖，也可以很好喝。',
        musicAndSfx: '轻微开罐声',
      })),
    };

    const parsed = CreativePlanSchema.parse(plan);
    expect(parsed.script.audioPlan?.bgm.style).toBe('轻快校园');
    expect(parsed.script.shots).toHaveLength(4);
    expect(parsed.script.shots[2]?.sourceDecision.kind).toBe('existing_asset');
  });

  it('accepts a valid four-scene creative plan', async () => {
    const provider: ReasoningProvider = { plan: async () => validPlan() };
    const result = await new CreativeBrain(provider).plan(state, { reason: 'initial' });
    expect(result.scenes).toHaveLength(4);
    expect(result.script.durationSec).toBe(15);
  });

  it('lets the planner choose selling point and style when the initial state leaves them unspecified', async () => {
    const unspecified = createInitialState({
      product: '低糖气泡咖啡',
      audience: '大学生',
      platform: 'douyin',
      duration: 15,
    });
    const provider: ReasoningProvider = { plan: async () => validPlan() };

    const result = await new CreativeBrain(provider).plan(unspecified, { reason: 'initial' });

    expect(result.constraints).toMatchObject({ sellingPoint: 'low_sugar', style: 'campus_vlog' });
  });

  it('fails visibly after one repair retry when plan duration stays invalid', async () => {
    let attempts = 0;
    const provider: ReasoningProvider = {
      plan: async () => {
        attempts += 1;
        const plan = validPlan() as unknown as { script: { durationSec: number } };
        plan.script.durationSec = 0;
        return plan as CreativePlan;
      },
    };

    await expect(new CreativeBrain(provider).plan(state, { reason: 'initial' })).rejects.toThrow(
      /invalid creative plan/i,
    );
    expect(attempts).toBe(2);
  });

  it('rejects plans whose explicit constraints disagree with the current state', async () => {
    const wrong = validPlan();
    wrong.constraints.sellingPoint = 'refreshing';
    const provider: ReasoningProvider = { plan: async () => wrong };

    await expect(new CreativeBrain(provider).plan(state, { reason: 'patch' })).rejects.toThrow(
      /constraints/i,
    );
  });

  it('uses the latest v2 state rather than chat history as planner authority', async () => {
    let observedSellingPoint = '';
    const provider: ReasoningProvider = {
      plan: async (input) => {
        observedSellingPoint = input.state.creative.sellingPoint;
        return validPlan();
      },
    };

    await new CreativeBrain(provider).plan(state, {
      reason: 'patch',
      conversationSummary: '旧对话曾经强调 refreshing',
    });
    expect(observedSellingPoint).toBe('low_sugar');
  });

  it('generates image references only for scenes that explicitly request one', async () => {
    const requested: string[] = [];
    const imageProvider: ImageProvider = {
      generateReference: async (input) => {
        requested.push(input.scene.id);
        return {
          id: `image_${input.scene.id}`,
          type: 'image',
          uri: `memory://${input.scene.id}.png`,
          source: 'live',
          stateVersion: input.stateVersion,
          sessionEpoch: input.sessionEpoch,
        };
      },
    };

    const artifacts = await generateImageReferences(validPlan(), imageProvider, {
      stateVersion: 2,
      sessionEpoch: 3,
    });

    expect(requested).toEqual(['scene_1']);
    expect(artifacts.map((artifact) => artifact.id)).toEqual(['image_scene_1']);
  });
});
