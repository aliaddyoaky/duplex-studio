# Duplex Studio 工作流与节点可观测性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Duplex Studio 改造成先上传素材和确认脚本、再执行视频与统一音频制作，并把每个节点的输入输出、下游传递、耗时和错误可视化。

**Architecture:** 保留 Gemini Live 作为 System 1、DeepSeek Creative Brain 作为 System 2，新增服务端阶段状态机和可观测任务 trace。视频片段不承担成片音频，AudioProvider 生成或选择独立音频产物，FFmpeg 在最终渲染阶段只挂载一条统一混音轨；项目版本和产物写入本地历史存储。

**Tech Stack:** TypeScript, React 19, Express 5, Zod, Vitest, FFmpeg/ffprobe, Vite。

**Spec:** `docs/superpowers/specs/2026-10-05-studio-workflow-v2-design.md`

## Global Constraints

- 未确认 ScriptPlan 前不得调用视频 provider。
- 片段视频必须静音，最终 MP4 只能由 `audio_mix` 提供音频轨。
- 所有 provider 结果携带 `stateVersion` 和 `sessionEpoch`，旧结果不得覆盖当前版本。
- 上传仅允许 `video/*`、`image/*`、`audio/*`，单文件上限 500 MB，服务端生成安全文件名。
- 不新增外部音频供应商依赖；先实现可替换的 AudioProvider 和本地 Replay/Hybrid 音频素材。
- 保留 LIVE、HYBRID、REPLAY 三种模式和现有 System 1 打断语义。

## Review Focus

- 确认前触发生成：测试创建项目和修改脚本都不会发起视频 provider 调用。
- 版本竞争：脚本规划、视频、音频或混音晚到时必须被 stale guard 丢弃，且旧版本历史仍可读。
- 统一音轨：片段原始音频不会进入最终文件，成片包含且只包含一条混音音轨。
- 上传安全：路径穿越、未知 MIME、超限文件和重复上传不会污染素材库。
- 节点可观测性：失败节点保留输入摘要、输出、耗时、错误码和可重试标记，UI 展开后能看到上下游关系。

---

### Task 1: 建立阶段状态与结构化脚本契约

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/shared/events.ts`
- Modify: `src/server/runtime/projectState.ts`
- Modify: `src/server/tools/creativeTools.ts`
- Test: `tests/projectState.test.ts`
- Test: `tests/creativeBrain.test.ts`

**Interfaces:**
- Produces `ProjectPhase`, `ScriptPlanSchema`, `TaskTraceSchema`, `AudioArtifact` and phase transition helpers.
- Keeps existing `SceneSchema`, `ArtifactSchema`, `IntentPatchSchema` compatible where possible.

- [ ] Write failing tests for ScriptPlan validation, project phase transitions, and the rule that a generated scene requires a confirmed production phase.
- [ ] Run `npm test -- tests/projectState.test.ts tests/creativeBrain.test.ts` and verify the new assertions fail for missing schemas/phase behavior.
- [ ] Add Zod schemas for direction, voiceover, audio plan, shot source decisions, candidates, and task trace; extend Artifact type with `audio`.
- [ ] Add `phase` and `projectId` to ProjectState with defaults that preserve old fixture parsing during migration.
- [ ] Update planner output schema/prompt to produce structured shots and explicit existing-vs-AIGC decisions.
- [ ] Run the focused tests, then the full suite.

### Task 2: Refactor orchestration into review-before-production

**Files:**
- Modify: `src/server/demo/orchestrator.ts`
- Modify: `src/server/runtime/invalidation.ts`
- Modify: `src/server/runtime/taskGraph.ts`
- Modify: `src/server/runtime/scheduler.ts`
- Test: `tests/goldenPath.test.ts`
- Test: `tests/invalidation.test.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Adds `confirmScript()` to `DemoOrchestrator`.
- Adds cancellation-aware planning and phase-aware `createProject()`/`applyPatch()` behavior.
- Produces explicit planning tasks (`product_analysis`, `script_generation`, `prompt_lint`, `asset_match`) before confirmation and production tasks after confirmation.

- [ ] Add tests proving `createProject()` ends in `SCRIPT_REVIEW` and a spy video provider has zero calls.
- [ ] Add tests proving `confirmScript()` transitions to `PRODUCING` and only generated shots create video tasks.
- [ ] Add tests proving a mid-production patch cancels affected video/audio/mix tasks while unaffected tasks are reused.
- [ ] Run the focused tests and observe the expected failures.
- [ ] Implement phase gates, confirmation, planning artifacts, cancellation-aware planner calls, and task graph dependencies.
- [ ] Update stale result handling so late planner/audio/render results are registered as rejected artifacts without changing current state.
- [ ] Run all orchestration and invalidation tests.

### Task 3: Add local asset library and upload endpoints

**Files:**
- Create: `src/server/assets/assetLibrary.ts`
- Create: `src/server/routes/assets.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/tools/assetSearch.ts`
- Modify: `src/shared/schemas.ts`
- Test: `tests/assets.test.ts`

**Interfaces:**
- `AssetLibrary.upload(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<Asset>`
- `AssetLibrary.list(filters?): Promise<Asset[]>`
- `AssetLibrary.update(id, patch): Promise<Asset>`
- Routes: `POST /api/assets/upload`, `GET /api/assets`, `PATCH /api/assets/:id`.

- [ ] Write tests for valid video/audio/image upload, safe filename normalization, unsupported MIME, oversize rejection, listing, tagging, and search.
- [ ] Run `npm test -- tests/assets.test.ts` and verify the new tests fail because the library/routes do not exist.
- [ ] Implement filesystem storage under `data/uploads` and metadata under `data/library.json`; register uploaded assets in the same search index as demo manifest assets.
- [ ] Mount the routes and proxy them through Vite if needed.
- [ ] Run asset tests and verify uploaded files are served through `/media/uploads` without exposing arbitrary paths.

### Task 4: Implement independent audio provider and unified mixer

**Files:**
- Create: `src/server/providers/audioProvider.ts`
- Modify: `src/server/tools/renderPreview.ts`
- Modify: `src/server/demo/orchestrator.ts`
- Create: `demo/assets/demo_bgm.wav` via a deterministic FFmpeg fixture command or a checked-in generated fixture.
- Test: `tests/audioProvider.test.ts`
- Test: `tests/renderPreview.test.ts`

**Interfaces:**
- `AudioProvider.generateVoiceover(input, signal?) -> Promise<AudioArtifact>`
- `AudioProvider.selectOrGenerateBgm(input, signal?) -> Promise<AudioArtifact>`
- `AudioProvider.prepareSfx(input, signal?) -> Promise<AudioArtifact[]>`
- `renderPreview({ clips, audioMix, ... })` returns an MP4 with one audio stream.

- [ ] Add failing tests for one voiceover/BGM/SFX task per project rather than per scene, and for final MP4 stream counts.
- [ ] Run focused audio/render tests and verify failure due to absent audio provider/mix support.
- [ ] Implement a local fixture provider that uses uploaded/demo audio assets and creates a deterministic duration-matched mix input.
- [ ] Update FFmpeg filters to force `-an` on clip inputs, concatenate video only, then mix voiceover/BGM/SFX once with explicit volume ducking and `-map 0:v -map 1:a`-style stream selection.
- [ ] Add task progress/error propagation and separate retry scope for audio/mix failures.
- [ ] Run audio/render tests and inspect ffprobe output for exactly one audio stream.

### Task 5: Persist project history and node details

**Files:**
- Create: `src/server/history/historyStore.ts`
- Create: `src/server/routes/history.ts`
- Modify: `src/server/demo/orchestrator.ts`
- Modify: `src/server/routes/project.ts`
- Modify: `src/server/routes/intent.ts`
- Modify: `src/server/routes/events.ts`
- Test: `tests/history.test.ts`
- Test: `tests/api.test.ts`

**Interfaces:**
- `HistoryStore.saveVersion(snapshot): Promise<void>`
- `HistoryStore.list(projectId): Promise<HistorySummary[]>`
- `HistoryStore.get(projectId, version): Promise<HistorySnapshot>`
- `GET /api/project/history`, `GET /api/project/history/:version`, `GET /api/tasks/:taskId`, `POST /api/project/confirm-script`, `POST /api/project/retry-task`.

- [ ] Add failing tests for immutable version snapshots, failed-version retention, task detail retrieval, confirmation validation, and retryable-only retry.
- [ ] Run focused API/history tests and verify failures for missing routes/storage.
- [ ] Implement atomic JSON writes under `data/projects/<projectId>/history/`, preserving artifact references and trace summaries.
- [ ] Record a version at script review, confirmation, production completion, and failure boundaries.
- [ ] Implement retry by creating a new attempt for the same logical task without mutating completed history.
- [ ] Run API/history tests and a full backend suite.

### Task 6: Surface trace data through the client store and APIs

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/state/useDemoStore.ts`
- Modify: `src/shared/events.ts`
- Modify: `src/client/components/AgentBrain.tsx`
- Create: `src/client/components/NodeDetail.tsx`
- Test: `tests/api.test.ts`

**Interfaces:**
- Client snapshot includes `phase`, `graph`, `nodeTrace`, `history` summaries and audio artifacts.
- `fetchTaskDetail(taskId)`, `confirmScript()`, `retryTask(taskId)`, `fetchHistory(version?)` are typed client calls.

- [ ] Add reducer tests for task trace updates, failed status, retry attempts, and session reset clearing stale details.
- [ ] Run focused client/state tests and observe missing fields/actions.
- [ ] Extend SSE/snapshot projection with input/output summaries, downstream IDs, duration, attempt, reuse source and normalized errors.
- [ ] Add `NodeDetail` with collapsible Inputs, Rules, Outputs, Downstream and Error sections; keep full prompt/JSON behind disclosure controls.
- [ ] Run client/state tests and typecheck.

### Task 7: Build the new frontend workflow surfaces

**Files:**
- Modify: `src/client/App.tsx`
- Create: `src/client/components/AssetLibrary.tsx`
- Create: `src/client/components/ScriptReview.tsx`
- Modify: `src/client/components/CreativeCanvas.tsx`
- Modify: `src/client/components/RealtimePanel.tsx`
- Modify: `src/client/components/Timeline.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/uiContracts.test.tsx` or browser verification via Playwright.

**Interfaces:**
- `AssetLibrary` handles upload/list/tag/select before a project exists.
- `ScriptReview` renders structured direction, audio plan, per-shot source decision and confirm action.
- `CreativeCanvas` renders a larger interactive player with selected scene playback and native controls.

- [ ] Add failing UI contract tests or DOM assertions for the upload surface, script review gate, confirm button, node detail disclosure, history entry and video controls.
- [ ] Implement phase-based layout: assets/briefing, script review, production, and completion.
- [ ] Wire voice confirmation phrase “开始制作” to the same typed `confirmScript()` action as the button.
- [ ] Make the main player large enough for pause, seek, volume and fullscreen; keep individual scene players selectable.
- [ ] Render node groups for planning, video fan-out, audio, polling, mix and final render with visible errors and retry affordances.
- [ ] Run Playwright/browser verification at desktop and narrow viewports, including an actual replay run.

### Task 8: Add replay fixtures and end-to-end verification

**Files:**
- Modify: `demo/fixtures/golden-project.json`
- Modify: `src/client/replayGoldenPath.ts`
- Modify: `README.md`
- Test: `tests/goldenPath.test.ts`
- Test: `tests/renderPreview.test.ts`

**Interfaces:**
- Replay covers upload/select asset, script review, confirmation, parallel video/audio, unified mix, preview and history lookup.

- [ ] Add a failing end-to-end replay assertion that video provider calls remain zero before confirmation and that final output has a single audio stream.
- [ ] Implement deterministic fixture planning, audio artifacts, trace payloads and history snapshots.
- [ ] Update README with the new user-facing workflow and the preserved System 1/System 2 explanation.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and the browser replay path.
- [ ] Use `ffprobe` on the final replay MP4 and inspect the node detail UI for input/output/error visibility.

## Final Verification

- [ ] Run the complete test suite and record the exact passing count.
- [ ] Run typecheck and production build.
- [ ] Run provider smoke checks without exposing credentials.
- [ ] Verify a pre-confirmation project never calls MiniMax.
- [ ] Verify an interrupted production cancels in-flight work and late results are marked stale.
- [ ] Verify the browser shows upload, script review, confirmation, node details, interactive player and history.
- [ ] Verify the final MP4 has the expected portrait video stream and exactly one audio stream.
