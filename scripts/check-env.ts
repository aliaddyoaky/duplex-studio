import { loadConfig } from '../src/server/config.js';
import { assertFfmpegAvailable } from '../src/server/tools/renderPreview.js';

try {
  process.loadEnvFile?.('.env.local');
} catch {}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) throw new Error(`Node.js 20+ required; found ${process.versions.node}`);
await assertFfmpegAvailable();

const config = loadConfig();
console.log(
  JSON.stringify({
    ok: true,
    node: process.versions.node,
    ffmpeg: true,
    liveModel: config.client.liveModel,
    reasoningModel: config.server.reasoningModel,
    minimaxApiHost: config.server.minimaxApiHost,
    videoModel: config.server.videoModel,
    demoMode: config.server.demoMode,
    geminiApiKeyConfigured: Boolean(config.server.geminiApiKey),
    deepseekApiKeyConfigured: Boolean(config.server.deepseekApiKey),
    minimaxApiKeyConfigured: Boolean(config.server.minimaxApiKey),
    liveReady: Boolean(
      config.server.geminiApiKey && config.server.deepseekApiKey && config.server.minimaxApiKey,
    ),
  }),
);
