import { z } from 'zod';

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_LIVE_MODEL: z.string().default('gemini-3.8-live'),
  GEMINI_VISION_MODEL: z.string().default('gemini-3.8-flash'),
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-pro'),
  MINIMAX_API_KEY: z.string().default(''),
  MINIMAX_API_HOST: z.string().url().default('https://api.minimax.io'),
  MINIMAX_VIDEO_MODEL: z.string().default('MiniMax-H3-Max'),
  DEMO_MODE: z.enum(['LIVE', 'HYBRID', 'REPLAY']).default('LIVE'),
  PORT: z.coerce.number().int().positive().default(3001),
});

export interface AppConfig {
  server: {
    geminiApiKey: string;
    deepseekApiKey: string;
    minimaxApiKey: string;
    minimaxApiHost: string;
    reasoningModel: string;
    videoModel: string;
    visionModel: string;
    demoMode: 'LIVE' | 'HYBRID' | 'REPLAY';
    port: number;
  };
  client: {
    liveModel: string;
    visionModel: string;
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    server: {
      geminiApiKey: parsed.GEMINI_API_KEY,
      deepseekApiKey: parsed.DEEPSEEK_API_KEY,
      minimaxApiKey: parsed.MINIMAX_API_KEY,
      minimaxApiHost: parsed.MINIMAX_API_HOST,
      reasoningModel: parsed.DEEPSEEK_MODEL,
      videoModel: parsed.MINIMAX_VIDEO_MODEL,
      visionModel: parsed.GEMINI_VISION_MODEL,
      demoMode: parsed.DEMO_MODE,
      port: parsed.PORT,
    },
    client: {
      liveModel: parsed.GEMINI_LIVE_MODEL,
      visionModel: parsed.GEMINI_VISION_MODEL,
    },
  };
}
