import { CreativeBrain } from '../src/server/agents/creativeBrain.js';
import { DeepSeekReasoningProvider } from '../src/server/providers/reasoningProvider.js';
import { createInitialState } from '../src/server/runtime/projectState.js';

try {
  process.loadEnvFile?.('.env.local');
} catch {}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.log('SKIP: DEEPSEEK_API_KEY is not configured; planner unit tests remain available.');
  process.exit(0);
}

const state = createInitialState({
  product: '低糖气泡咖啡',
  audience: '大学生',
  platform: 'douyin',
  duration: 15,
});
state.creative.sellingPoint = 'low_sugar';
state.creative.style = 'campus_vlog';
state.creative.tone = 'relaxed';

const provider = new DeepSeekReasoningProvider({
  apiKey,
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro',
  reasoningEffort: 'low',
});
const plan = await new CreativeBrain(provider).plan(state, { reason: 'initial' });
console.log(JSON.stringify({ ok: true, scenes: plan.scenes.length, constraints: plan.constraints }));
