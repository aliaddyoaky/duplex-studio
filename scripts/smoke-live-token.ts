import { GeminiLiveTokenProvider } from '../src/server/providers/liveTokenProvider.js';

try {
  process.loadEnvFile?.('.env.local');
} catch {}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log('SKIP: GEMINI_API_KEY is not configured; real Live token smoke is pending credentials.');
  process.exit(0);
}

const provider = new GeminiLiveTokenProvider({ apiKey });
const session = await provider.mint();

// Deliberately never print the bearer token, even in a local smoke run.
console.log(JSON.stringify({ ok: true, liveModel: session.liveModel, tokenMinted: true }));
