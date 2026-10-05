import { describe, expect, it } from 'vitest';

import { createInitialState } from '../src/server/runtime/projectState.js';
import {
  DeepSeekReasoningProvider,
  type DeepSeekResponsesClient,
} from '../src/server/providers/reasoningProvider.js';

const validPlan = {
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
  },
  scenes: [
    {
      id: 'scene_1',
      durationSec: 3,
      visualDescription: '宿舍晨间生活记录',
      source: 'generated_video',
      generationPrompt: 'authentic college dorm morning',
      needsImageReference: false,
    },
    {
      id: 'scene_2',
      durationSec: 3,
      visualDescription: '校园朋友自然聊天',
      source: 'existing_asset',
      assetQuery: 'campus friends walk',
      needsImageReference: false,
    },
    {
      id: 'scene_3',
      durationSec: 3,
      visualDescription: '真实产品罐低糖信息',
      source: 'existing_asset',
      assetQuery: 'low sugar coffee can product',
      needsImageReference: false,
    },
    {
      id: 'scene_4',
      durationSec: 6,
      visualDescription: '草坪日常感收尾',
      source: 'existing_asset',
      assetQuery: 'campus young lifestyle walk',
      needsImageReference: false,
    },
  ],
};

function planningState() {
  const state = createInitialState({
    product: '低糖气泡咖啡',
    audience: '大学生',
    platform: 'douyin',
    duration: 15,
  });
  state.creative.sellingPoint = 'low_sugar';
  state.creative.style = 'campus_vlog';
  state.creative.tone = 'relaxed';
  return state;
}

describe('DeepSeek reasoning provider', () => {
  it('requests low-effort schema-constrained planning and returns a validated CreativePlan', async () => {
    let requestBody: unknown;
    const client: DeepSeekResponsesClient = {
      create: async (body) => {
        requestBody = body;
        return {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(validPlan) }],
            },
          ],
        };
      },
    };
    const provider = new DeepSeekReasoningProvider({
      apiKey: 'test-key',
      client,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'low',
    });

    const plan = await provider.plan({ state: planningState(), context: { reason: 'initial' } });

    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-pro',
      reasoning: { effort: 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: 'creative_plan',
        },
      },
    });
    expect(plan.constraints).toEqual(validPlan.constraints);
    expect(plan.scenes).toHaveLength(4);
  });

  it('fails when DeepSeek completes without an output_text plan', async () => {
    const client: DeepSeekResponsesClient = {
      create: async () => ({ status: 'completed', output: [{ type: 'reasoning', content: [] }] }),
    };
    const provider = new DeepSeekReasoningProvider({ apiKey: 'test-key', client });

    await expect(
      provider.plan({ state: planningState(), context: { reason: 'initial' } }),
    ).rejects.toThrow(/output_text/i);
  });
});
