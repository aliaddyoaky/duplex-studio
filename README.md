# Duplex Studio

Interview demo for a realtime creative-video Agent: Gemini Live handles low-latency conversation, DeepSeek V4 Pro is the single Creative Brain, MiniMax H3 Max generates real video, and a deterministic Runtime owns versioned state, task invalidation, cancellation, stale-result rejection, artifact routing, and FFmpeg preview rendering.

## Quick start

Requirements: Node 20+, `ffmpeg`, and `ffprobe`.

```bash
npm install
cp .env.example .env.local
npm run check:env
npm run dev
```

Open `http://localhost:5173`.

Do not put any long-lived provider key in client code. `.env.local` is gitignored; the server mints one-use constrained Gemini tokens for the browser Live connection while DeepSeek and MiniMax remain server-only.

## Workflow

The user-facing flow is deliberately gated:

1. Upload video, image, and audio assets into the local library. Uploaded content is deduplicated, tagged, and searchable alongside the demo manifest.
2. Enter the product, audience, platform, and duration brief. The Creative Brain returns a structured ScriptPlan with shot descriptions, source decisions, matched assets or AIGC prompts, voiceover, and a unified audio plan.
3. Review the plan. Video generation and audio generation do not start until the user presses **开始制作** or says “开始”.
4. Production fans out into video, voiceover, BGM, and SFX tasks. Clips are rendered without their own audio; FFmpeg adds one final mixed audio stream.
5. Every version is retained in local history. Select any runtime node to inspect inputs, outputs, downstream tasks, duration, attempt, reuse, and retryable errors. A production patch cancels affected work and keeps unaffected results when the stale guard allows reuse.

The large preview uses native video controls for pause, seek, volume, and fullscreen. LIVE remains interruptible: Gemini Live is System 1, DeepSeek Creative Brain is System 2, and deterministic Runtime owns state, cancellation, invalidation, stale-result rejection, and media assembly.

## Interview Golden Path

Use **LIVE** by default. Connect Duplex Voice and speak exactly these three turns:

1. Upload a few product or campus clips, then say: `帮我给这款气泡咖啡做一个 15 秒抖音广告，目标用户是大学生，轻松一点，不要太商业。`
2. Review the generated ScriptPlan and say `开始制作` after checking the source decision and audio plan.
3. While v1 work is still visible: `等等，不要强调提神，重点突出低糖，而且整体别像广告，像大学生真实生活记录。`
4. `第三个镜头别生成了，换成真实产品素材。`

What to point out while presenting:

- Turn 1 is a Live `createProject` tool call; Runtime creates State v1 instead of letting the voice model own project state.
- Turn 2 is an `IntentPatch`, not full regeneration. Watch reused/cancelled tasks and `STALE — DROPPED` in the observability timeline.
- Turn 3 changes only Scene 3 routing from generated video to an existing product asset, then re-renders.
- The final preview is a real `video/mp4`. In LIVE, at least one scene is expected from the real video provider.

The `Fallback: Seed Brief` button is intentionally secondary. It exists for stage reliability, not as the primary Turn 1 path.

## Reliability modes

| Mode | Meaning |
| --- | --- |
| LIVE | Real Live voice, Creative Brain, video provider, Runtime, and FFmpeg. |
| HYBRID | Runtime stays real; failed video jobs use clearly marked cached fallback artifacts. |
| REPLAY | Fixture planner + recorded scene artifacts; no reasoning/video provider call is required. |

When **REPLAY** is selected, `Run Golden Replay` replays all three turns from the UI. It advances on preview state boundaries (v1 → v2 → v3), not fixed sleeps.

## Pre-interview smoke

```bash
npm test
npm run typecheck
npm run build
npm run check:env
npm run smoke:live-token
npm run smoke:planner
npm run smoke:video
```

The three provider smokes use separate credentials: `GEMINI_API_KEY` for Live, `DEEPSEEK_API_KEY` for planning, and `MINIMAX_API_KEY` for video. A key being syntactically valid is not enough: confirm each account has usable quota/billing. `smoke:video` must return an actual portrait MP4 accepted by `ffprobe` before calling the demo LIVE-ready.

MiniMax keys are regional. Keep `MINIMAX_API_HOST=https://api.minimax.io` for a Global key; use `https://api.minimaxi.com` for a Mainland key. The key and host must come from the same MiniMax region or the API returns `invalid api key`.

If Node runs behind an environment proxy and plain `fetch` cannot resolve Google while `curl` can, Node 24 can be launched with `NODE_USE_ENV_PROXY=1`. This is an environment workaround, not an application requirement.

## Current provider defaults

```text
GEMINI_LIVE_MODEL=gemini-3.8-live
DEEPSEEK_MODEL=deepseek-v4-pro
MINIMAX_VIDEO_MODEL=MiniMax-H3-Max
MINIMAX_API_HOST=https://api.minimax.io
DEMO_MODE=LIVE
```

The Live browser path uses the current `v1beta` endpoint and one-use ephemeral tokens. Keep model IDs configurable because preview availability and quota can differ by account.

## Architecture rule of thumb

The demo deliberately does **not** turn every step into an autonomous sub-agent. Realtime conversation is System 1; one Creative Brain is System 2; deterministic code owns state transitions and execution. That split is the core product/engineering argument: use model autonomy where semantic judgment is valuable, and deterministic orchestration where consistency, cancellation, observability, and stale-result safety matter more.
