# Duplex Studio 工作流与节点可观测性设计

## 目标

将 Duplex Studio 从“创建项目后立即生成视频”的演示流程，升级为可审阅、可确认、可修改、可追溯的广告制作工作流：用户先准备素材并描述需求，AI 生成结构化脚本和制作方向，用户确认后才消耗视频生成额度；视频片段保持静音，配音、BGM 和音效在最终阶段统一混音；每个节点都能查看输入、输出、下游传递、耗时和错误；每个版本都可回看。

## 范围与非目标

本次覆盖：

- 上传、预览、标签化和选择用户素材。
- 需求收集、结构化脚本生成、素材匹配和用户确认。
- 视频、音频分离的制作任务图，以及最终统一混音。
- 可交互的片段和成片播放器。
- 节点级输入输出、状态、错误和传递关系可视化。
- 项目版本和历史产物的本地持久化。

本次不绑定某一个新的外部音频供应商。音频链路先定义 `AudioProvider` 接口，并支持用户上传/内置音频素材和本地 FFmpeg 混音；真实 TTS、BGM 或音效模型通过该接口接入，不改变上层工作流。旧工作流中的“固定只能生成一个 AIGC 镜头”等平台规则不作为本项目约束。

## 核心用户流程

```text
素材准备
  -> 需求收集
  -> 脚本与制作方向生成
  -> 脚本/镜头/音频方案审核
  -> 用户确认
  -> 视频与音频任务并行执行
  -> 结果查询与校验
  -> 统一混音
  -> 最终合成
  -> 历史版本归档
```

### 阶段状态

项目阶段使用以下枚举：

- `ASSET_PREP`: 素材准备，可上传、预览、标签和删除可恢复的素材。
- `BRIEFING`: 用户通过语音或文字描述需求。
- `SCRIPT_REVIEW`: AI 已生成脚本、分镜、素材匹配和音频方案，等待用户确认。
- `PRODUCING`: 用户已确认，开始执行视频、音频和结果查询任务。
- `MIXING`: 视频片段已就绪，正在统一处理口播、BGM、音效和最终混音。
- `COMPLETED`: 预览和所有关联产物已完成。
- `FAILED`: 当前版本存在不可恢复的失败，保留错误上下文和可重试节点。

阶段只允许服务端推进。脚本审核阶段的编辑不会生成视频；生产阶段的修改会创建新版本并按受影响字段重新规划任务。

## 数据契约

### 结构化脚本与制作方案

`ProjectState.script` 从不透明值升级为可校验的 `ScriptPlan`：

```ts
interface ScriptPlan {
  version: number;
  direction: {
    hook: string;
    rationale: string;
    style: string;
    targetAudience: string;
    durationSec: number;
  };
  voiceover: {
    language: string;
    text: string;
    estimatedSeconds: number;
    compliance: { passed: boolean; notes: string[] };
  };
  audioPlan: {
    bgm: { style: string; intensity: string; assetId?: string };
    soundEffects: Array<{ atSec: number; description: string; assetId?: string }>;
    ducking: { voiceoverDb: number; bgmDb: number };
  };
  shots: Array<{
    order: number;
    id: string;
    durationSec: number;
    visualDescription: string;
    sourceDecision: {
      kind: 'existing_asset' | 'generated_video';
      reason: string;
      candidates: string[];
    };
    existingClip?: { assetId: string; startSec?: number; endSec?: number };
    aigcPrompt?: string;
    voiceover: string;
    onScreenText?: string;
    musicAndSfx: string;
  }>;
}
```

`Artifact` 的 `type` 枚举增加 `audio`，并用以下窄类型承载音频产物：

```ts
type AudioArtifact = Artifact & { type: 'audio' };
```

字段语义参考旧工作流中的 `clip_order`、`filter_tag`、`optional_clip_ids`、`start_time`、`end_time` 和 `estimated_time`，但使用可读的枚举和对象结构。脚本输出必须经过 Zod 校验；校验失败时创建修复任务，不能静默继续生产。

### 素材

用户上传素材保存到 `data/uploads`，元数据保存到 `data/library.json`。首版允许 `video/*`、`image/*` 和 `audio/*`，单文件上限 500 MB；服务端按 MIME 白名单和安全文件名校验，不能使用客户端传入路径覆盖服务端目录。`Asset` 增加 `status`、`name`、`mimeType`、`durationSec`、`width`、`height`、`createdAt` 和可编辑 `tags`。静态 demo 素材继续通过现有 manifest 载入，并和用户素材统一进入搜索索引。

### 音频 provider

音频能力通过窄接口隔离，不把具体供应商字段泄漏到项目状态：

```ts
interface AudioProvider {
  generateVoiceover(input: {
    text: string;
    language: string;
    stateVersion: number;
    sessionEpoch: number;
  }, signal?: AbortSignal): Promise<AudioArtifact>;
  selectOrGenerateBgm(input: {
    style: string;
    durationSec: number;
    assetIds: string[];
    stateVersion: number;
    sessionEpoch: number;
  }, signal?: AbortSignal): Promise<AudioArtifact>;
  prepareSfx(input: {
    cues: ScriptPlan['audioPlan']['soundEffects'];
    stateVersion: number;
    sessionEpoch: number;
  }, signal?: AbortSignal): Promise<AudioArtifact[]>;
}
```

`AudioArtifact` 使用现有 artifact 注册表的引用方式，音频文件写入 `data/artifacts`。没有外部音频 provider 时，Replay/Hybrid 使用用户上传或 demo 音频素材；不能用静默成功掩盖 provider 失败。

### 节点追踪

`TaskRecord` 增加可观测字段：

```ts
interface TaskTrace {
  inputs: Array<{ name: string; kind: string; ref?: string; summary: string }>;
  outputs: Array<{ name: string; kind: string; ref?: string; summary: string }>;
  downstream: string[];
  durationMs?: number;
  attempt: number;
  reusedFrom?: string;
  error?: { code: string; message: string; retryable: boolean };
}
```

输入输出只保存摘要和产物引用，不把完整视频、音频或超长 prompt 复制进事件流。完整 prompt 和结构化 JSON 作为可按需读取的 artifact 或详情接口返回。

## 任务图

确认前的任务图只运行规划类节点：

```text
brief + asset library
  -> product_analysis
  -> script_generation
  -> prompt_lint
  -> asset_match
  -> script_review
```

确认后的任务图为：

```text
confirmed ScriptPlan
  -> generate_video(scene_n)  [仅 sourceDecision=generated_video]
  -> select_existing_asset(scene_n)
  -> generate_voiceover       [一次，不按镜头拆分]
  -> select_or_generate_bgm
  -> prepare_sfx
  -> poll_video_jobs
  -> validate_media
  -> audio_mix                [统一音频轨]
  -> render_preview           [视频静音片段 + 单一混音轨]
  -> archive_version
```

视频生成输入必须显式关闭片段声音或在最终渲染时丢弃片段音轨。`render_preview` 先拼接画面，再将 `audio_mix` 作为唯一音频轨道映射到 MP4，避免片段之间 BGM、音量和口播不连续。

旧流程中“切片数据处理、结果整理、并发生成、轮询和汇总”的思想保留为逻辑节点；实际 provider 请求仍由现有 MiniMax provider 和新的 AudioProvider 封装，所有异步结果必须通过 `clip order` 或稳定的 `scene id` 对齐。

## API 与持久化

增加以下服务端接口：

- `POST /api/assets/upload`: 接收单个原始媒体文件，返回 Asset 元数据。
- `GET /api/assets`: 返回素材库和可筛选标签。
- `PATCH /api/assets/:id`: 更新名称和标签。
- `GET /api/project/history`: 返回当前项目的版本摘要。
- `GET /api/project/history/:version`: 返回指定版本的状态、任务、事件和产物引用。
- `POST /api/project/confirm-script`: 校验并确认当前 ScriptPlan，推进到 `PRODUCING`。
- `POST /api/project/retry-task`: 仅重试失败且 `retryable=true` 的节点。
- `GET /api/tasks/:taskId`: 返回单节点完整输入输出详情和错误信息。

当前 `/api/project` 仍可创建项目，但创建后只到 `SCRIPT_REVIEW`，不再自动启动视频任务。用户点击“确认并开始制作”或通过实时语音确认短语“开始制作”时，客户端调用 `POST /api/project/confirm-script`。已有 replay 入口保留，并用完整的节点 trace 填充演示数据。

## 前端信息架构

### 素材库

左侧或独立抽屉显示上传区、素材筛选、缩略图、时长、标签和已选状态。上传完成后立即可预览，不要求先创建项目。

### 脚本审核

中央工作区在 `SCRIPT_REVIEW` 阶段显示：整体方向、口播全文、音频计划、镜头表、每个镜头的素材候选和 AIGC prompt。用户可逐镜头修改来源或重写描述，然后点击确认。

### 节点详情

“创意大脑”改为可展开节点流：

- 节点卡片显示名称、阶段、状态、耗时、尝试次数和输入输出数量。
- 点击后显示“输入 / 处理规则 / 输出 / 下游 / 错误”五个区域。
- 长 prompt、原始 JSON、素材列表和 provider 响应默认折叠。
- 失败节点显示错误码、用户可读消息、是否可重试和重试入口。
- 并发视频、音频和轮询节点按组显示，组内显示进度和单项结果。

### 播放器与历史

主预览区使用足够大的竖屏 `<video controls preload="metadata">`，支持暂停、拖拽、音量、倍速和浏览器全屏。点击镜头卡片可以切换片段。历史抽屉可打开任意版本，并联动查看该版本的脚本、节点、片段、音频和最终成片。

## 错误与恢复

- Prompt 或脚本 JSON 校验失败：进入修复节点，原始响应保留，不能直接进入确认。
- 素材未命中：显示候选为空和原因，允许用户上传/选择素材或批准 AIGC。
- 视频 provider 失败：节点记录 provider 错误码和额度/网络信息；只重试失败镜头。
- 音频 provider 失败：不重新生成视频，可单独重试音频链路。
- 混音或 FFmpeg 失败：保留视频片段和音频产物，允许只重试 `audio_mix` 或 `render_preview`。
- 任何版本失败都不能覆盖已完成版本；历史记录保留失败版本和可恢复节点。

## 验收标准

1. 未确认脚本时，不能发起 MiniMax 视频生成请求。
2. 每个镜头清楚显示已有素材或 AIGC 的决定、理由和候选素材。
3. 最终 MP4 只有一条统一混音音轨，片段原始音轨不会串入成片。
4. 节点详情能看到输入摘要、输出引用、下游节点、耗时、错误和重试信息。
5. 上传素材可以在脚本匹配节点中被检索并在镜头中选择。
6. 播放器支持暂停、进度拖拽、音量和全屏，且在桌面和窄窗口下可见。
7. 每次脚本修改和重新制作都形成可打开的历史版本。
8. 既有 Replay、Hybrid 和 Live 模式继续可用；额度不足时不会伪装成成功。

## 测试策略

- Zod schema 测试：ScriptPlan、Asset、TaskTrace 和阶段迁移。
- 任务图测试：确认前不含视频任务，确认后只生成 AIGC 镜头并包含音频/混音依赖。
- 音频渲染测试：视频片段静音、最终 MP4 包含单一音频轨，时长与画面一致。
- 上传和素材匹配测试：中文标签、用户素材、时间范围和无命中错误。
- 历史测试：版本不可变、失败版本可读取、重试不覆盖旧产物。
- UI 测试：脚本审核、确认、节点详情展开、错误显示、播放器 controls 和历史切换。
- 端到端 Replay：覆盖上传素材、脚本确认、并发任务、统一混音、最终预览和历史回看。
