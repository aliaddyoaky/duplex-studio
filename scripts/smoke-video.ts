import { execFileSync } from 'node:child_process';

import { MiniMaxVideoProvider } from '../src/server/providers/videoProvider.js';

try {
  process.loadEnvFile?.('.env.local');
} catch {}

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.log('SKIP: MINIMAX_API_KEY is not configured; real video smoke is pending credentials.');
  process.exit(0);
}

const provider = new MiniMaxVideoProvider({
  apiKey,
  apiHost: process.env.MINIMAX_API_HOST,
  model: process.env.MINIMAX_VIDEO_MODEL ?? 'MiniMax-H3-Max',
});
const artifact = await provider.generate({
  prompt:
    'Vertical authentic handheld college campus vlog, a student picks up a sparkling coffee can in soft morning light, subtle natural motion, photorealistic.',
  aspectRatio: '9:16',
  resolution: '720p',
  stateVersion: 1,
  sessionEpoch: 1,
});
const probe = execFileSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', artifact.uri],
  { encoding: 'utf8' },
);
console.log(JSON.stringify({ ok: true, artifact, ffprobe: JSON.parse(probe) }));
