# Duplex Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost interview demo where a user can converse with a realtime voice Agent, interrupt and revise intent while background creative tasks run, dynamically replan only affected work, generate at least one real AI video clip, and compose a 10–15 second final preview.

**Architecture:** A React/Vite client connects directly to Gemini 3.8 Live with a short-lived token for low-latency speech, while a Node/Express Duplex Runtime owns versioned project state, the dependency-aware task graph, cancellation, stale-result protection, creative-model/tool calls, artifacts, and event traces. System 2 is one Creative Brain behind a provider interface; real video generation uses a `VideoProvider` with `gemini-omni-1.1-flash` as the first live implementation, and FFmpeg composes generated clips plus existing assets.

**Tech Stack:** TypeScript, React 19, Vite, Node.js 20+, Express, Zod, Vitest, Supertest, `@google/genai`, Server-Sent Events, Web Audio API, FFmpeg.

**Spec:** `docs/superpowers/specs/2026-10-04-duplex-studio-design.md`

## Global Constraints

- This is a 2–3 day interview prototype; prioritize the Golden Path over general platform features.
- Run on localhost; no cloud deployment, login system, project dashboard, distributed queue, LangGraph, Temporal, Celery, or vector database.
- System 1 is realtime interaction; System 2 is one Creative Brain. Do not create a multi-agent swarm.
- Every meaningful user revision is an `IntentPatch` that increments `ProjectState.version`.
- Runtime dependency rules, cancellation, result acceptance, and stale-result rejection are deterministic code paths.
- At least one Golden Path scene must be returned by a real video-generation API as an actual `video/mp4` artifact.
- Default live video model is `gemini-omni-1.1-flash`, portrait `9:16`, default `720p`; keep it behind `VideoProvider` and configurable by environment.
- Final preview is a real 10–15 second mp4 composed with FFmpeg from generated and/or existing video clips.
- Timeline and metrics are derived from the Event Log; do not hard-code interview numbers.
- A stale or cancelled v1 result must never become an active artifact after Project State v2 is committed.
- LIVE, HYBRID, and REPLAY modes must be visibly distinguishable; cached artifacts must never be presented as live generations.
- Do not put long-lived Gemini API keys in browser code. Browser Live sessions receive a short-lived token from the server.
- Persist traces and generated artifacts below `data/`; exclude API keys, generated videos, logs, and build outputs from git.

## Review Focus

1. **Overlapping intent patches:** a second patch arriving before v1 cancellation finishes must create one monotonic current version and reject every older result; pin this in Task 4.
2. **Realtime reconnect / microphone interruption:** losing the Live session must not corrupt Runtime state, and reconnect must be possible without resetting the creative project; pin this in Task 9.
3. **Video API timeout or malformed result:** a missing/invalid mp4 must mark the task failed and enter explicit HYBRID fallback without registering a fake live artifact; pin this in Task 8.
4. **SSE reconnect:** reconnecting the UI must obtain a state snapshot plus later events without duplicating task state; pin this in Task 5.
5. **Demo reset with work still running:** reset must abort all controllable work, bump the session epoch, and reject late results from the previous epoch; pin this in Task 11.

---

## Locked File Map

Implementation lives in a new `duplex-studio/` directory so the existing workflow research files remain untouched.

```text
duplex-studio/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  .env.example
  .gitignore
  index.html
  src/
    shared/
      schemas.ts              # Zod schemas + shared inferred types
      events.ts               # Event names and event payload types
    server/
      app.ts                  # Express construction; no listen side effects
      index.ts                # process entrypoint
      config.ts               # env parsing/default model ids/timeouts
      runtime/
        projectState.ts       # state creation + patch commits
        invalidation.ts       # field -> task dependency map
        taskGraph.ts          # graph/task records and replanning
        scheduler.ts          # task execution and AbortController ownership
        staleGuard.ts         # version/session-epoch result acceptance
        artifactRegistry.ts   # active/stale/failed artifacts
        eventLog.ts           # append-only events, snapshot, metrics inputs
      agents/
        creativeBrain.ts      # System 2 plan/replan interface
      providers/
        reasoningProvider.ts  # provider contract + Gemini implementation
        imageProvider.ts      # optional reference-image provider contract
        liveTokenProvider.ts  # ephemeral Live token minting
        videoProvider.ts      # video contract + Gemini Omni implementation
      tools/
        creativeTools.ts      # analyze/script/storyboard adapters
        assetSearch.ts        # local demo asset retrieval
        generateImageReference.ts # reference-image tool for scenes that need it
        generateVideo.ts      # VideoProvider -> ClipArtifact adapter
        renderPreview.ts      # FFmpeg composer
      demo/
        orchestrator.ts       # Golden Path task orchestration
        fallback.ts           # LIVE/HYBRID/REPLAY policy
        replay.ts             # JSONL replay
      routes/
        session.ts            # ephemeral Live token route
        intent.ts             # initial intent + patch route
        events.ts             # SSE route
        project.ts            # state snapshot/reset/artifact routes
    client/
      main.tsx
      App.tsx
      api.ts                  # Runtime REST + SSE client
      realtime/
        liveSession.ts        # Gemini Live connect/callbacks/function tool
        audioCapture.ts       # microphone -> 16-bit PCM
        audioPlayback.ts      # 24 kHz model audio queue + clear on interrupt
      state/
        useDemoStore.ts       # state/event/task/artifact UI reducer
      components/
        RealtimePanel.tsx
        CreativeCanvas.tsx
        AgentBrain.tsx
        Timeline.tsx
        Metrics.tsx
        StateDiff.tsx
  tests/
    projectState.test.ts
    invalidation.test.ts
    scheduler.test.ts
    eventLog.test.ts
    api.test.ts
    creativeBrain.test.ts
    videoProvider.test.ts
    renderPreview.test.ts
    liveSession.test.ts
    goldenPath.test.ts
    resetReplay.test.ts
  demo/
    assets/
      manifest.json
    fixtures/
      golden-project.json
      golden-plan-v1.json
      golden-plan-v2.json
    fallback/
      README.md
  data/
    artifacts/.gitkeep
    traces/.gitkeep
  scripts/
    check-env.ts
    smoke-video.ts
    smoke-live-token.ts
  docs/
    superpowers/
      specs/2026-10-04-duplex-studio-design.md
      plans/2026-10-04-duplex-studio-implementation.md
```

## Day 1 — Realtime interaction and authoritative state

### Task 1: Project shell, shared schemas, and health endpoint

**Files:**
- Create: `duplex-studio/package.json`
- Create: `duplex-studio/tsconfig.json`
- Create: `duplex-studio/vite.config.ts`
- Create: `duplex-studio/vitest.config.ts`
- Create: `duplex-studio/.env.example`
- Create: `duplex-studio/.gitignore`
- Create: `duplex-studio/index.html`
- Create: `duplex-studio/src/shared/schemas.ts`
- Create: `duplex-studio/src/server/config.ts`
- Create: `duplex-studio/src/server/app.ts`
- Create: `duplex-studio/src/server/index.ts`
- Create: `duplex-studio/src/client/main.tsx`
- Create: `duplex-studio/src/client/App.tsx`
- Test: `duplex-studio/tests/api.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ProjectStateSchema`, `IntentPatchSchema`, `TaskRecordSchema`, `SceneSchema`, `ArtifactSchema`; `createApp(deps?: AppDeps): Express`; `loadConfig(env): AppConfig`.

- [ ] **Step 1: Scaffold the single-workspace TypeScript app and copy the approved spec/plan into `duplex-studio/docs/superpowers/`**

Use Node 20+, ESM, Vite for the browser, `tsx` for server development, Vitest for tests, and one `npm run dev` command that starts Vite and Express. Initialize a git repository inside `duplex-studio/`; do not add or alter unrelated parent-workspace files.

- [ ] **Step 2: Write the failing schema/config/health tests**

Assert that a minimal valid `ProjectState` parses, an invalid version is rejected, `loadConfig` never exposes `GEMINI_API_KEY` to client config, and `GET /api/health` returns `{ ok: true }`.

- [ ] **Step 3: Run the targeted tests and verify failure**

Run: `npm test -- tests/api.test.ts`

Expected: FAIL because schemas and `createApp` do not exist.

- [ ] **Step 4: Implement the minimal shared schemas, config, Express app factory, entrypoint, and React shell**

Pin environment names: `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL=gemini-3.8-live`, `GEMINI_REASONING_MODEL=gemini-3.1-pro-preview`, `GEMINI_VIDEO_MODEL=gemini-omni-1.1-flash`, `DEMO_MODE=LIVE`, `PORT=3001`.

- [ ] **Step 5: Verify tests, typecheck, and production build**

Run: `npm test -- tests/api.test.ts && npm run typecheck && npm run build`

Expected: all PASS; Vite emits a client build.

- [ ] **Step 6: Commit**

Commit message: `chore: scaffold duplex studio`

### Task 2: Versioned Project State and Intent Patch commits

**Files:**
- Create: `duplex-studio/src/server/runtime/projectState.ts`
- Modify: `duplex-studio/src/shared/schemas.ts`
- Test: `duplex-studio/tests/projectState.test.ts`

**Interfaces:**
- Consumes: `ProjectState`, `IntentPatch` from Task 1.
- Produces: `createInitialState(brief): ProjectState`; `commitIntentPatch(current, patch): PatchCommitResult`; `PatchCommitResult = { previous: ProjectState; current: ProjectState; changedFields: string[] }`.

- [ ] **Step 1: Write failing tests for v0→v1 creation, v1→v2 patching, changed-field extraction, and stale `baseVersion` rejection**

Use the interview example: `creative.sellingPoint: refreshing → low_sugar` and `creative.style: youth_ad → campus_vlog`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/projectState.test.ts`

- [ ] **Step 3: Implement immutable state creation and `commitIntentPatch`**

Do not mutate the previous state. Reject patches whose `baseVersion !== current.version` with a typed `VERSION_CONFLICT` error.

- [ ] **Step 4: Run the tests and verify pass**

Run: `npm test -- tests/projectState.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: add versioned project state`

### Task 3: Dependency-aware task invalidation and replanning

**Files:**
- Create: `duplex-studio/src/server/runtime/invalidation.ts`
- Create: `duplex-studio/src/server/runtime/taskGraph.ts`
- Test: `duplex-studio/tests/invalidation.test.ts`

**Interfaces:**
- Consumes: `changedFields: string[]`, `TaskRecord[]`, `ProjectState.version`.
- Produces: `classifyTasks(tasks, changedFields): InvalidationResult`; `replanGraph(previousGraph, newVersion, invalidation): TaskGraph`; actions are `KEEP | REUSE | CANCEL | CREATE`.

- [ ] **Step 1: Write failing dependency tests**

Assert: changing `creative.sellingPoint` cancels script/storyboard/generated scenes/render but reuses product analysis; changing only `scenes.scene_3.source` preserves Scene 1/2/4 and replans Scene 3 + render; unknown fields conservatively invalidate downstream creative work.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/invalidation.test.ts`

- [ ] **Step 3: Implement the explicit field→task dependency table and graph replan**

No LLM call is allowed inside `invalidation.ts`.

- [ ] **Step 4: Run and verify pass**

Run: `npm test -- tests/invalidation.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: add dependency-aware replanning`

### Task 4: Parallel scheduler, cancellation, session epoch, and stale-result guard

**Files:**
- Create: `duplex-studio/src/server/runtime/scheduler.ts`
- Create: `duplex-studio/src/server/runtime/staleGuard.ts`
- Create: `duplex-studio/src/server/runtime/artifactRegistry.ts`
- Test: `duplex-studio/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `TaskGraph`, task runner functions `(ctx: TaskContext) => Promise<TaskResult>`.
- Produces: `Scheduler.start(task)`, `Scheduler.cancel(taskId)`, `Scheduler.cancelAll()`; `acceptResult(result, currentVersion, currentEpoch): ResultDisposition`; `ArtifactRegistry.register()` only accepts `ACCEPT` dispositions.

- [ ] **Step 1: Write failing concurrency tests**

Cover parallel independent tasks, cancellable task abort, uncancellable v1 task returning after v2, two overlapping patches creating v2 then v3, and a previous-session result arriving after reset epoch changes.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/scheduler.test.ts`

- [ ] **Step 3: Implement scheduler ownership of `AbortController` plus `{ sessionEpoch, stateVersion }` result guards**

Result acceptance requires both epoch and version match. A late result is recorded as stale but never made active.

- [ ] **Step 4: Run and verify pass**

Run: `npm test -- tests/scheduler.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: guard async task consistency`

### Task 5: Event Log, SSE transport, and metric primitives

**Files:**
- Create: `duplex-studio/src/shared/events.ts`
- Create: `duplex-studio/src/server/runtime/eventLog.ts`
- Create: `duplex-studio/src/server/routes/events.ts`
- Modify: `duplex-studio/src/server/app.ts`
- Test: `duplex-studio/tests/eventLog.test.ts`

**Interfaces:**
- Consumes: runtime state/task lifecycle changes.
- Produces: `eventLog.append(type, payload)`, `eventLog.snapshot()`, `eventLog.after(sequence)`, `computeMetrics(events): RuntimeMetrics`, `GET /api/events`, `GET /api/project/snapshot`; each event carries `sequence`, `timestamp`, `sessionEpoch`, `stateVersion?`.

- [ ] **Step 1: Write failing event-order and reconnect tests**

Assert monotonic sequence IDs, required event names, and that an SSE reconnect using the last seen sequence receives one current snapshot plus only later events without duplicating task state. Pin metric formulas exactly: `firstResponseMs = AGENT_RESPONSE_START - USER_SPEECH_END`; `interruptReactionMs = AGENT_INTERRUPTED - USER_SPEECH_START`; `replanLatencyMs = NEW_TASK_GRAPH_STARTED - INTENT_PATCH_COMMITTED`; `taskReuseRate = reusedTasks / existingTasksAtPatch`.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/eventLog.test.ts`

- [ ] **Step 3: Implement the append-only in-memory event log plus JSONL append hook and SSE route**

Do not make JSONL replay authoritative during LIVE operation; Project State remains authoritative in memory.

- [ ] **Step 4: Run and verify pass**

Run: `npm test -- tests/eventLog.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: stream runtime events`

## Day 2 — Creative Brain, real video, and final composition

### Task 6: System 2 Creative Brain and typed creative plan

**Files:**
- Create: `duplex-studio/src/server/providers/reasoningProvider.ts`
- Create: `duplex-studio/src/server/providers/imageProvider.ts`
- Create: `duplex-studio/src/server/agents/creativeBrain.ts`
- Create: `duplex-studio/src/server/tools/creativeTools.ts`
- Create: `duplex-studio/src/server/tools/generateImageReference.ts`
- Create: `duplex-studio/demo/fixtures/golden-plan-v1.json`
- Create: `duplex-studio/demo/fixtures/golden-plan-v2.json`
- Test: `duplex-studio/tests/creativeBrain.test.ts`

**Interfaces:**
- Consumes: `ProjectState`, accepted artifacts, planner context.
- Produces: `ReasoningProvider.plan(input): Promise<CreativePlan>`; `CreativeBrain.plan(state, context): Promise<CreativePlan>` where the plan contains strategy, script, four typed scenes, and source routing; `ImageProvider.generateReference(input): Promise<ImageArtifact>` behind `generateImageReference()` for scenes that benefit from an image anchor before video generation.

- [ ] **Step 1: Write failing tests against a fake ReasoningProvider**

Assert the Creative Brain validates a four-scene plan, rejects invalid duration/source values, preserves explicit user constraints, can create a v2 plan from a state patch without reading chat history as the source of truth, and invokes the image-reference provider only when a scene plan explicitly requests one.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/creativeBrain.test.ts`

- [ ] **Step 3: Implement provider contract, Gemini provider, Zod validation, and Creative Brain wrapper**

Provider output must validate before it becomes a task plan. One retry is allowed for schema repair; after that the planner task fails visibly.

- [ ] **Step 4: Add and run an opt-in live planner smoke command**

Run: `npm run smoke:planner`

Expected with `GEMINI_API_KEY`: returns a valid four-scene `CreativePlan`; without key: exits with a clear setup message, not a test failure.

- [ ] **Step 5: Run unit tests and commit**

Commit message: `feat: add creative brain planner`

### Task 7: Local asset search and scene-source routing

**Files:**
- Create: `duplex-studio/src/server/tools/assetSearch.ts`
- Create: `duplex-studio/demo/assets/manifest.json`
- Add: a small licensed/user-provided demo asset set under `duplex-studio/demo/assets/`
- Test: `duplex-studio/tests/goldenPath.test.ts`

**Interfaces:**
- Consumes: `Scene.assetQuery`, manifest tags.
- Produces: `searchAssets(query, limit): AssetMatch[]`; Scene source remains `generated_video | existing_asset`.

- [ ] **Step 1: Write failing deterministic retrieval/routing tests**

Assert a campus/product query returns the expected fixture asset and that changing Scene 3 from `generated_video` to `existing_asset` leaves other scenes' source unchanged.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/goldenPath.test.ts`

- [ ] **Step 3: Implement lightweight tag/text scoring and scene routing adapter**

Do not add a vector database. Asset metadata must include provenance/license note for interview hygiene.

- [ ] **Step 4: Run and verify pass**

Run: `npm test -- tests/goldenPath.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: route scenes to local assets`

### Task 8: Real AI video generation and artifact validation

**Files:**
- Create: `duplex-studio/src/server/providers/videoProvider.ts`
- Create: `duplex-studio/src/server/tools/generateVideo.ts`
- Create: `duplex-studio/src/server/demo/fallback.ts`
- Create: `duplex-studio/scripts/smoke-video.ts`
- Test: `duplex-studio/tests/videoProvider.test.ts`

**Interfaces:**
- Consumes: `VideoGenerationInput { prompt, aspectRatio: '9:16', resolution: '720p', stateVersion, sessionEpoch }`.
- Produces: `VideoProvider.generate(input, signal?): Promise<VideoArtifact>`; Gemini implementation uses model id from `GEMINI_VIDEO_MODEL`, default `gemini-omni-1.1-flash`.

- [ ] **Step 1: Write failing provider tests with a fake `@google/genai` client**

Assert the request uses `response_format.type='video'`, `aspect_ratio='9:16'`, `resolution='720p'`; decoded bytes must be non-empty mp4; provider timeout/missing video output returns a typed failure; HYBRID fallback marks the artifact source as `fallback` rather than `live`.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/videoProvider.test.ts`

- [ ] **Step 3: Implement `GeminiOmniVideoProvider` using the Interactions API**

Use `gemini-omni-1.1-flash` and write returned base64 video bytes into `data/artifacts/<artifactId>.mp4`. Validate MIME/type and non-zero file size before registering the artifact.

- [ ] **Step 4: Add a real smoke script and run it when credentials are available**

Run: `npm run smoke:video`

Expected: one portrait 720p mp4 saved under `data/artifacts/`, non-zero size, readable by `ffprobe`.

- [ ] **Step 5: Run unit tests and commit**

Commit message: `feat: generate real ai video clips`

### Task 9: Gemini Live browser session, microphone PCM, playback, and Intent Patch tool

**Files:**
- Create: `duplex-studio/src/server/providers/liveTokenProvider.ts`
- Create: `duplex-studio/src/server/routes/session.ts`
- Create: `duplex-studio/src/client/realtime/audioCapture.ts`
- Create: `duplex-studio/src/client/realtime/audioPlayback.ts`
- Create: `duplex-studio/src/client/realtime/liveSession.ts`
- Create: `duplex-studio/scripts/smoke-live-token.ts`
- Test: `duplex-studio/tests/liveSession.test.ts`

**Interfaces:**
- Consumes: microphone PCM, Runtime `POST /api/intent/patch`.
- Produces: `createLiveSession(config): LiveSessionController`; methods `connect()`, `startMic()`, `stopMic()`, `disconnect()`; callbacks `onTranscript`, `onSpeaking`, `onInterrupted`, `onIntentPatch`.

- [ ] **Step 1: Write failing tests for token route and Live event adapter**

Assert the browser receives only an ephemeral token; `serverContent.interrupted` clears queued model audio; `applyIntentPatch` invokes the Runtime API; reconnect creates a new Live connection without resetting Project State.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/liveSession.test.ts`

- [ ] **Step 3: Implement server-side token minting constrained to `gemini-3.8-live`**

Token lifetime is short and one-session scoped. Never serialize the long-lived API key into a route response.

- [ ] **Step 4: Implement browser capture/playback**

Capture raw little-endian 16-bit PCM and declare the actual sample rate (target 16 kHz); enqueue model PCM output at 24 kHz; clear the output queue immediately on interruption.

- [ ] **Step 5: Implement Live session callbacks, input/output transcription, automatic VAD, and the `applyIntentPatch` Function Tool**

The tool submits only structured intent changes; it never executes creative tools directly.

- [ ] **Step 6: Run token smoke test plus manual microphone smoke**

Run: `npm run smoke:live-token`, then `npm run dev`; manually verify speech → audio response → barge-in stops playback → state patch reaches Runtime.

- [ ] **Step 7: Commit**

Commit message: `feat: add realtime duplex voice session`

### Task 10: FFmpeg composition and final preview artifacts

**Files:**
- Create: `duplex-studio/src/server/tools/renderPreview.ts`
- Create: `duplex-studio/scripts/check-env.ts`
- Test: `duplex-studio/tests/renderPreview.test.ts`

**Interfaces:**
- Consumes: ordered `ClipArtifact[]`, scene durations, captions, output artifact id.
- Produces: `renderPreview(input: RenderInput, signal?): Promise<VideoArtifact>` and `assertFfmpegAvailable(): Promise<void>`.

- [ ] **Step 1: Write a failing FFmpeg integration test using tiny generated color/video fixtures**

Assert output exists, is `9:16`, duration is between 10 and 15 seconds for the Golden fixture, and `ffprobe` sees a video stream.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/renderPreview.test.ts`

- [ ] **Step 3: Implement trim/scale/crop/concat plus simple caption overlay**

Keep transitions simple. Normalize mixed input clips before concat; do not implement a general timeline editor.

- [ ] **Step 4: Run FFmpeg test and environment check**

Run: `npm test -- tests/renderPreview.test.ts && npm run check:env`

- [ ] **Step 5: Commit**

Commit message: `feat: compose final video preview`

## Day 3 — Integrated Golden Path, observability, and reliability

### Task 11: Golden Path orchestrator, reset, fallback, and replay

**Files:**
- Create: `duplex-studio/src/server/demo/orchestrator.ts`
- Create: `duplex-studio/src/server/demo/replay.ts`
- Create: `duplex-studio/src/server/routes/intent.ts`
- Create: `duplex-studio/src/server/routes/project.ts`
- Modify: `duplex-studio/src/server/app.ts`
- Create: `duplex-studio/demo/fixtures/golden-project.json`
- Test: `duplex-studio/tests/resetReplay.test.ts`
- Modify: `duplex-studio/tests/goldenPath.test.ts`

**Interfaces:**
- Consumes: Project State, Creative Brain, Scheduler, Tools, Event Log, Artifact Registry.
- Produces: `DemoOrchestrator.createProject()`, `applyPatch()`, `reset()`, `setMode(LIVE|HYBRID|REPLAY)`; routes `POST /api/project`, `POST /api/intent/patch`, `POST /api/demo/reset`, `POST /api/demo/mode`.

- [ ] **Step 1: Write failing Golden Path integration tests entirely with fake external providers**

Replay the three interview turns. Assert v1 creation, v2 selling-point/style patch, product-analysis reuse, affected-task cancellation, stale v1 result rejection, Scene 3 local reroute, and final preview registration.

- [ ] **Step 2: Write the reset/fallback/replay failure-mode tests**

Assert reset aborts controllable tasks and increments `sessionEpoch`; a late pre-reset result is rejected; LIVE video timeout enters visibly marked HYBRID only if policy allows; REPLAY never claims to call a live provider.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/goldenPath.test.ts tests/resetReplay.test.ts`

- [ ] **Step 4: Implement orchestrator and routes using earlier interfaces**

Inject a configurable delayed-result wrapper for one v1 task so the interview can deterministically demonstrate `STALE_RESULT_DROPPED` without changing the underlying provider result.

- [ ] **Step 5: Run integration tests and verify pass**

Run: `npm test -- tests/goldenPath.test.ts tests/resetReplay.test.ts`

- [ ] **Step 6: Commit**

Commit message: `feat: integrate golden demo flow`

### Task 12: Interview UI, State Diff, Agent Brain, Timeline, and metrics

**Files:**
- Create: `duplex-studio/src/client/api.ts`
- Create: `duplex-studio/src/client/state/useDemoStore.ts`
- Create: `duplex-studio/src/client/components/RealtimePanel.tsx`
- Create: `duplex-studio/src/client/components/CreativeCanvas.tsx`
- Create: `duplex-studio/src/client/components/AgentBrain.tsx`
- Create: `duplex-studio/src/client/components/Timeline.tsx`
- Create: `duplex-studio/src/client/components/Metrics.tsx`
- Create: `duplex-studio/src/client/components/StateDiff.tsx`
- Modify: `duplex-studio/src/client/App.tsx`
- Test: extend `duplex-studio/tests/api.test.ts`

**Interfaces:**
- Consumes: `/api/project/snapshot`, `/api/events`, Runtime REST commands, Live session callbacks.
- Produces: the single-page Creative IDE + Agent Observatory interface.

- [ ] **Step 1: Add failing API/reducer tests**

Assert State v1→v2 diff, task status transitions, stale badge, LIVE/HYBRID/REPLAY badge, and metrics computed from event timestamps rather than constants.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/api.test.ts`

- [ ] **Step 3: Implement SSE/REST client and one central reducer/store**

Do not maintain a second authoritative copy of creative state in component-local state; server snapshots/events drive the display.

- [ ] **Step 4: Implement the four visual zones**

Left: Realtime; center: four Scene cards + final video; right: Agent Brain with Reuse/Cancel/Replan/Stale; bottom: Timeline + metrics. Include one prominent `Reset Demo` control and the current State version.

- [ ] **Step 5: Verify responsive desktop layout and core UI states**

Run: `npm run dev`; manually check 1440×900 and 1920×1080, microphone permission failure, Live disconnected, video generating, stale task, fallback artifact, preview ready.

- [ ] **Step 6: Commit**

Commit message: `feat: build duplex studio interview ui`

### Task 13: Full verification, real live run, and interview rehearsal assets

**Files:**
- Modify as required only for defects discovered by verification.
- Generate locally (gitignored): `duplex-studio/data/traces/golden-live.jsonl`
- Generate locally (gitignored): final live artifacts under `duplex-studio/data/artifacts/`

**Interfaces:**
- Consumes: all completed P0 components.
- Produces: a repeatable LIVE Golden Path plus HYBRID and REPLAY fallbacks.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test && npm run typecheck && npm run build && npm run check:env`

Expected: all tests PASS, zero type errors, build succeeds, FFmpeg and required non-secret configuration are available.

- [ ] **Step 2: Run real provider smoke tests**

Run: `npm run smoke:live-token && npm run smoke:planner && npm run smoke:video`

Expected: Live token created, valid CreativePlan returned, real portrait mp4 produced and accepted by `ffprobe`.

- [ ] **Step 3: Run the complete LIVE Golden Path manually**

Use exactly the three interview turns from the spec. Verify a real generated clip appears in the final preview and one controlled v1 result is visibly discarded as stale.

- [ ] **Step 4: Save the successful trace and populate explicit fallback artifacts**

Mark fallback metadata with `source: fallback` and keep it separate from the live trace/artifacts.

- [ ] **Step 5: Run HYBRID and REPLAY with network/provider failures simulated**

Expected: both modes finish without claiming cached results are live.

- [ ] **Step 6: Rehearse the Golden Path 10 times**

Record pass/fail and failure cause. Target: at least 9/10 complete runs before interview use.

- [ ] **Step 7: Final commit**

Commit message: `test: verify interview demo reliability`

## API / Credential Handoff

Before Tasks 6, 8, and 9 can complete their live smoke checks, the development environment needs a Gemini API key with access to the selected Live, reasoning, and video-generation models. Store it only in `duplex-studio/.env.local` as:

```text
GEMINI_API_KEY=...
```

If the account cannot access `gemini-omni-1.1-flash`, do not redesign the Runtime. Implement another `VideoProvider` for an available Seedance/Kling/Veo endpoint and preserve the exact `VideoArtifact` contract and Golden Path tests.

## Cut Line if Development Slips

Never cut: realtime voice, barge-in, Intent Patch, versioned state, dependency replanning, stale-result guard, one real AI video clip, FFmpeg final preview, visible event timeline.

Cut first: multimodal critic, automated repair, arbitrary product uploads, extra video providers, fancy transitions, semantic/vector asset retrieval, mobile layout, cloud deployment.
