import type { Artifact, IntentPatch, ProjectState, TaskRecord } from '../../shared/schemas.js';
import { ArtifactSchema, ProjectStateSchema } from '../../shared/schemas.js';
import type { RuntimeMetrics } from '../../shared/events.js';
import type { CreativePlan } from '../tools/creativeTools.js';
import type { VideoArtifact, VideoProvider } from '../providers/videoProvider.js';
import { ArtifactRegistry } from '../runtime/artifactRegistry.js';
import { EventLog, computeMetrics } from '../runtime/eventLog.js';
import { classifyTasks } from '../runtime/invalidation.js';
import {
  commitIntentPatch,
  createInitialState,
  transitionProjectPhase,
  type PatchCommitResult,
} from '../runtime/projectState.js';
import { Scheduler, type TaskContext, type TaskResult } from '../runtime/scheduler.js';
import { acceptResult } from '../runtime/staleGuard.js';
import { replanGraph, type TaskGraph } from '../runtime/taskGraph.js';
import { searchAssets } from '../tools/assetSearch.js';
import { renderPreview as renderPreviewReal, type RenderInput } from '../tools/renderPreview.js';
import type { DemoMode } from './fallback.js';
import { ReplayCatalog } from './replay.js';

export interface DemoPlanner {
  plan(
    state: ProjectState,
    context: { reason: 'initial' | 'patch'; changedFields?: string[] },
  ): Promise<CreativePlan>;
}

export type RenderPreviewFn = (input: RenderInput, signal?: AbortSignal) => Promise<VideoArtifact>;
export type ResultDelay = (
  task: TaskRecord,
  result: Promise<TaskResult>,
  signal: AbortSignal,
) => Promise<TaskResult>;

export function createCancellationReleasedDelay(target: {
  taskType: string;
  stateVersion: number;
}): ResultDelay {
  return async (task, result, signal) => {
    const resolved = await result;
    if (task.type !== target.taskType || task.stateVersion !== target.stateVersion || signal.aborted) {
      return resolved;
    }
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return resolved;
  };
}

export interface DemoOrchestratorOptions {
  planner: DemoPlanner;
  replayPlanner?: DemoPlanner;
  videoProvider: VideoProvider;
  renderPreview?: RenderPreviewFn;
  eventLog?: EventLog;
  artifactRegistry?: ArtifactRegistry;
  delayResult?: ResultDelay;
  allowHybridFallback?: boolean;
  fallbackVideoByScene?: Record<string, VideoArtifact>;
  replayCatalog?: ReplayCatalog;
}

export interface DemoSnapshot {
  state: ProjectState | null;
  tasks: TaskRecord[];
  graph: TaskGraph | null;
  artifacts: Artifact[];
  rejectedArtifacts: ReturnType<ArtifactRegistry['rejected']>;
  events: ReturnType<EventLog['snapshot']>;
  metrics: RuntimeMetrics;
  mode: DemoMode;
  sessionEpoch: number;
}

export class DemoOrchestrator {
  readonly eventLog: EventLog;
  private readonly registry: ArtifactRegistry;
  private readonly planner: DemoPlanner;
  private readonly replayPlanner?: DemoPlanner;
  private readonly videoProvider: VideoProvider;
  private readonly previewRenderer: RenderPreviewFn;
  private readonly delayResult?: ResultDelay;
  private readonly allowHybridFallback: boolean;
  private readonly fallbackVideoByScene: Record<string, VideoArtifact>;
  private readonly replayCatalog?: ReplayCatalog;
  private readonly scheduler: Scheduler;
  private readonly activeRuns = new Set<Promise<void>>();
  private readonly sceneArtifacts = new Map<string, VideoArtifact>();

  private state: ProjectState | null = null;
  private graph: TaskGraph | null = null;
  private mode: DemoMode = 'LIVE';
  private sessionEpoch = 1;

  constructor(options: DemoOrchestratorOptions) {
    this.planner = options.planner;
    this.replayPlanner = options.replayPlanner;
    this.videoProvider = options.videoProvider;
    this.previewRenderer = options.renderPreview ?? renderPreviewReal;
    this.eventLog = options.eventLog ?? new EventLog();
    this.registry = options.artifactRegistry ?? new ArtifactRegistry();
    this.delayResult = options.delayResult;
    this.allowHybridFallback = options.allowHybridFallback ?? false;
    this.fallbackVideoByScene = options.fallbackVideoByScene ?? {};
    this.replayCatalog = options.replayCatalog;
    this.scheduler = new Scheduler(
      (context) => {
        const result = this.executeTask(context);
        return this.delayResult ? this.delayResult(context.task, result, context.signal) : result;
      },
      () => this.sessionEpoch,
    );
  }

  async createProject(brief: ProjectState['brief']): Promise<ProjectState> {
    if (this.state) throw new Error('A demo project already exists; reset before creating another');
    const initial = createInitialState(brief);
    const plan = await this.currentPlanner().plan(initial, { reason: 'initial' });
    this.state = transitionProjectPhase(applyCreativePlan(initial, plan), 'SCRIPT_REVIEW');
    this.graph = { version: 1, tasks: buildPlanningTasks(this.state), decisions: [] };
    this.eventLog.append(
      'NEW_TASK_GRAPH_STARTED',
      { taskCount: this.graph.tasks.length, reason: 'create' },
      this.context(1),
    );
    this.launchCurrentGraph();
    await this.settle();
    return structuredClone(this.state);
  }

  async confirmScript(): Promise<ProjectState> {
    if (!this.state || !this.graph) throw new Error('Create a project before confirming its script');
    if (this.state.phase !== 'SCRIPT_REVIEW') {
      throw new Error(`Cannot confirm script while project is ${this.state.phase}`);
    }

    this.state = transitionProjectPhase(this.state, 'PRODUCING');
    this.graph = {
      version: this.state.version,
      tasks: buildProductionTasks(this.state, this.graph.tasks),
      decisions: [],
    };
    this.eventLog.append(
      'NEW_TASK_GRAPH_STARTED',
      { taskCount: this.graph.tasks.length, reason: 'script_confirmed' },
      this.context(this.state.version),
    );
    this.launchCurrentGraph();
    return structuredClone(this.state);
  }

  async applyPatch(patch: IntentPatch): Promise<PatchCommitResult> {
    if (!this.state || !this.graph) throw new Error('Create a project before applying intent patches');
    const previousVersion = this.state.version;
    const currentTasks = this.graph.tasks.filter(
      (task) => task.stateVersion === previousVersion && task.status !== 'cancelled',
    );
    const committed = commitIntentPatch(this.state, patch);
    this.state = committed.current;
    if (this.state.phase === 'COMPLETED' || this.state.phase === 'FAILED') {
      this.state = transitionProjectPhase(this.state, 'SCRIPT_REVIEW');
    }
    this.eventLog.append(
      'INTENT_PATCH_COMMITTED',
      {
        patchId: patch.patchId,
        changedFields: committed.changedFields,
        existingTasksAtPatch: currentTasks.length,
      },
      this.context(this.state.version),
    );
    this.eventLog.append(
      'STATE_UPDATED',
      { fromVersion: previousVersion, toVersion: this.state.version, changedFields: committed.changedFields },
      this.context(this.state.version),
    );

    if (this.state.phase === 'SCRIPT_REVIEW') {
      if (committed.changedFields.some((field) => field.startsWith('creative.') || field.startsWith('brief.'))) {
        const plan = await this.currentPlanner().plan(this.state, {
          reason: 'patch',
          changedFields: committed.changedFields,
        });
        this.state = applyCreativePlan(this.state, plan);
      }
      this.graph = { version: this.state.version, tasks: buildPlanningTasks(this.state), decisions: [] };
      this.eventLog.append(
        'NEW_TASK_GRAPH_STARTED',
        { taskCount: this.graph.tasks.length, reason: 'script_review_patch' },
        this.context(this.state.version),
      );
      this.launchCurrentGraph();
      await this.settle();
      return { ...committed, current: structuredClone(this.state) };
    }

    const invalidation = classifyTasks(currentTasks, committed.changedFields);
    const nextGraph = replanGraph(
      { version: previousVersion, tasks: currentTasks, decisions: [] },
      this.state.version,
      invalidation,
    );
    for (const decision of nextGraph.decisions) {
      const task = nextGraph.tasks.find((candidate) => candidate.id === decision.taskId);
      if (decision.action === 'REUSE') {
        this.eventLog.append(
          'TASK_REUSED',
          { taskId: decision.taskId, taskType: task?.type },
          this.context(this.state.version),
        );
      } else if (decision.action === 'CANCEL') {
        this.scheduler.cancel(decision.taskId);
        this.eventLog.append(
          'TASK_CANCELLED',
          { taskId: decision.taskId, taskType: task?.type, reason: 'intent_patch' },
          this.context(this.state.version),
        );
      }
    }
    this.graph = nextGraph;

    if (committed.changedFields.some((field) => field.startsWith('creative.') || field.startsWith('brief.'))) {
      const plan = await this.currentPlanner().plan(this.state, {
        reason: 'patch',
        changedFields: committed.changedFields,
      });
      this.state = applyCreativePlan(this.state, plan);
    }

    this.eventLog.append(
      'NEW_TASK_GRAPH_STARTED',
      { taskCount: this.graph.tasks.length, reason: 'intent_patch' },
      this.context(this.state.version),
    );
    this.launchCurrentGraph();
    return { ...committed, current: structuredClone(this.state) };
  }

  reset(): { sessionEpoch: number; abortedTasks: number } {
    const abortedTasks = this.scheduler.cancelAll();
    this.sessionEpoch += 1;
    this.state = null;
    this.graph = null;
    this.registry.clear();
    this.sceneArtifacts.clear();
    return { sessionEpoch: this.sessionEpoch, abortedTasks };
  }

  setMode(mode: DemoMode): DemoMode {
    this.mode = mode;
    return this.mode;
  }

  snapshot(): DemoSnapshot {
    const events = this.eventLog.snapshot();
    return {
      state: this.state ? structuredClone(this.state) : null,
      tasks: this.graph ? structuredClone(this.graph.tasks) : [],
      graph: this.graph ? structuredClone(this.graph) : null,
      artifacts: this.registry.active(),
      rejectedArtifacts: this.registry.rejected(),
      events,
      metrics: computeMetrics(events),
      mode: this.mode,
      sessionEpoch: this.sessionEpoch,
    };
  }

  async settle(): Promise<void> {
    while (this.activeRuns.size > 0) {
      await Promise.allSettled([...this.activeRuns]);
    }
  }

  private launchCurrentGraph(waitForTaskType?: string): Promise<void> {
    if (!this.graph || !this.state) return Promise.resolve();
    const version = this.state.version;
    const runnable = this.graph.tasks.filter(
      (task) => task.stateVersion === version && task.status === 'pending' && task.type !== 'render',
    );
    const renderDependencies: Promise<void>[] = [];
    let requestedRun: Promise<void> | undefined;
    for (const task of runnable) {
      if (task.type.startsWith('generated_scene:')) {
        const sceneId = task.type.slice('generated_scene:'.length);
        const scene = this.state.scenes.find((candidate) => candidate.id === sceneId);
        if (scene?.source !== 'generated_video') {
          task.status = 'cancelled';
          continue;
        }
      }
      const run = this.track(this.startTask(task));
      if (task.type.startsWith('generated_scene:')) renderDependencies.push(run);
      if (task.type === waitForTaskType) requestedRun = run;
    }
    const coordinator = Promise.allSettled(renderDependencies).then(async () => {
      if (!this.state || this.state.version !== version || !this.graph) return;
      const render = this.graph.tasks.find(
        (task) => task.stateVersion === version && task.type === 'render' && task.status === 'pending',
      );
      if (render) await this.startTask(render);
    });
    this.track(coordinator);
    return requestedRun ?? Promise.resolve();
  }

  private track(run: Promise<void>): Promise<void> {
    this.activeRuns.add(run);
    void run.finally(() => this.activeRuns.delete(run));
    return run;
  }

  private async startTask(task: TaskRecord): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.eventLog.append(
      'TASK_STARTED',
      { taskId: task.id, taskType: task.type },
      { sessionEpoch: this.sessionEpoch, stateVersion: task.stateVersion },
    );
    try {
      const result = await this.scheduler.start(task);
      const disposition = acceptResult(result, this.state?.version ?? 0, this.sessionEpoch);
      const artifact = ArtifactSchema.safeParse(result.value);
      if (disposition !== 'ACCEPT') {
        task.status = 'stale';
        task.finishedAt = Date.now();
        const graphTask = this.graph?.tasks.find(
          (candidate) => candidate.id === task.id && candidate.stateVersion === task.stateVersion,
        );
        if (graphTask) {
          graphTask.status = 'stale';
          graphTask.finishedAt = task.finishedAt;
        }
        if (artifact.success) this.registry.register(artifact.data, disposition);
        this.eventLog.append(
          'STALE_RESULT_DROPPED',
          { taskId: task.id, taskType: task.type, disposition },
          { sessionEpoch: result.sessionEpoch, stateVersion: task.stateVersion },
        );
        return;
      }

      task.status = 'completed';
      task.finishedAt = Date.now();
      if (artifact.success) {
        this.registry.register(artifact.data, disposition);
        task.artifactIds = [artifact.data.id];
        if (task.type.startsWith('generated_scene:')) {
          const sceneId = task.type.slice('generated_scene:'.length);
          this.sceneArtifacts.set(sceneId, artifact.data as VideoArtifact);
          if (this.state) {
            this.state = ProjectStateSchema.parse({
              ...this.state,
              generatedClips: [...this.state.generatedClips, artifact.data],
            });
          }
        } else if (task.type === 'render' && this.state) {
          this.state = ProjectStateSchema.parse({
            ...this.state,
            phase: this.state.phase === 'PRODUCING' ? 'COMPLETED' : this.state.phase,
            preview: artifact.data,
          });
          this.eventLog.append(
            'PREVIEW_READY',
            { artifactId: artifact.data.id },
            this.context(this.state.version),
          );
        }
      }
      this.eventLog.append(
        'TASK_COMPLETED',
        { taskId: task.id, taskType: task.type, artifactId: artifact.success ? artifact.data.id : undefined },
        this.context(task.stateVersion),
      );
    } catch (error) {
      task.status = 'failed';
      task.finishedAt = Date.now();
      if (task.type.startsWith('generated_scene:')) {
        this.eventLog.append(
          'VIDEO_JOB_COMPLETED',
          { taskId: task.id, taskType: task.type, status: 'failed', error: errorMessage(error) },
          this.context(task.stateVersion),
        );
      }
    }
  }

  private async executeTask(context: TaskContext): Promise<TaskResult> {
    const { task, signal, sessionEpoch } = context;
    const base: Omit<TaskResult, 'value'> = {
      taskId: task.id,
      stateVersion: task.stateVersion,
      sessionEpoch,
    };
    if (!this.state) return base;

    if (task.type.startsWith('generated_scene:')) {
      const sceneId = task.type.slice('generated_scene:'.length);
      const scene = this.state.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new Error(`Unknown scene task ${sceneId}`);
      this.eventLog.append(
        'VIDEO_JOB_SUBMITTED',
        { taskId: task.id, sceneId, mode: this.mode },
        this.context(task.stateVersion),
      );
      const artifact = await this.generateSceneVideo(sceneId, scene.generationPrompt ?? scene.visualDescription, task, signal);
      this.eventLog.append(
        'VIDEO_JOB_COMPLETED',
        { taskId: task.id, sceneId, source: artifact.source },
        this.context(task.stateVersion),
      );
      return { ...base, value: artifact };
    }

    if (task.type === 'render') {
      const clips = this.state.scenes.map((scene) => {
        let artifact: VideoArtifact | undefined;
        if (scene.source === 'generated_video') artifact = this.sceneArtifacts.get(scene.id);
        else {
          const match = searchAssets(scene.assetQuery ?? scene.visualDescription, 1)[0];
          if (match) {
            artifact = {
              id: `asset_${match.id}`,
              type: 'video',
              uri: match.uri,
              source: 'existing',
              stateVersion: task.stateVersion,
              sessionEpoch,
            };
          }
        }
        if (!artifact) throw new Error(`No renderable artifact for ${scene.id}`);
        return {
          artifact,
          durationSec: scene.durationSec,
          caption: scene.narration ?? scene.visualDescription,
        };
      });
      return {
        ...base,
        value: await this.previewRenderer(
          {
            clips,
            outputId: `preview_v${task.stateVersion}`,
            stateVersion: task.stateVersion,
            sessionEpoch,
          },
          signal,
        ),
      };
    }

    return base;
  }

  private async generateSceneVideo(
    sceneId: string,
    prompt: string,
    task: TaskRecord,
    signal: AbortSignal,
  ): Promise<VideoArtifact> {
    if (this.mode === 'REPLAY') {
      if (!this.replayCatalog) throw new Error('REPLAY mode requires a replay catalog');
      return this.replayCatalog.video(sceneId, task.stateVersion, this.sessionEpoch);
    }

    const input = {
      prompt,
      aspectRatio: '9:16' as const,
      resolution: '720p' as const,
      stateVersion: task.stateVersion,
      sessionEpoch: this.sessionEpoch,
    };
    try {
      return await this.videoProvider.generate(input, signal);
    } catch (error) {
      const fallback = this.fallbackVideoByScene[sceneId];
      if ((this.mode === 'HYBRID' || (this.mode === 'LIVE' && this.allowHybridFallback)) && fallback) {
        if (this.mode === 'LIVE') this.mode = 'HYBRID';
        return {
          ...fallback,
          source: 'fallback',
          stateVersion: task.stateVersion,
          sessionEpoch: this.sessionEpoch,
        };
      }
      throw error;
    }
  }

  private context(stateVersion?: number) {
    return { sessionEpoch: this.sessionEpoch, stateVersion };
  }

  private currentPlanner(): DemoPlanner {
    return this.mode === 'REPLAY' && this.replayPlanner ? this.replayPlanner : this.planner;
  }
}

function applyCreativePlan(state: ProjectState, plan: CreativePlan): ProjectState {
  return ProjectStateSchema.parse({
    ...state,
    creative: {
      ...state.creative,
      sellingPoint: plan.constraints.sellingPoint,
      style: plan.constraints.style,
    },
    script: plan.script,
    scenes: plan.scenes,
  });
}

function buildPlanningTasks(state: ProjectState): TaskRecord[] {
  const tasks = [
    makeTask(state, 'product_analysis', 'product_analysis', [], ['brief.product']),
    makeTask(state, 'script', 'script', ['product_analysis'], ['creative.sellingPoint', 'brief.duration']),
    makeTask(state, 'asset_search', 'asset_search', ['product_analysis'], ['creative.style', 'creative.tone']),
    makeTask(state, 'storyboard', 'storyboard', ['script'], ['creative.sellingPoint', 'creative.style', 'creative.tone']),
    makeTask(state, 'prompt_lint', 'prompt_lint', ['storyboard'], ['creative.style', 'creative.tone']),
  ];
  return tasks;
}

function buildProductionTasks(state: ProjectState, previousTasks: TaskRecord[]): TaskRecord[] {
  const planningTasks = previousTasks
    .filter((task) => !task.type.startsWith('generated_scene:') && task.type !== 'render')
    .map((task) => ({ ...task, stateVersion: state.version, status: 'completed' as const }));
  const generated = state.scenes
    .filter((scene) => scene.source === 'generated_video')
    .map((scene) =>
      makeTask(
        state,
        `generate_${scene.id}`,
        `generated_scene:${scene.id}`,
        ['storyboard'],
        [`scenes.${scene.id}`, 'creative.style', 'creative.tone'],
      ),
    );
  const renderDependencies = generated.map((task) => task.id);
  return [
    ...planningTasks,
    ...generated,
    makeTask(state, 'render', 'render', renderDependencies, ['scenes', 'creative', 'brief.duration']),
  ];
}

function makeTask(
  state: ProjectState,
  id: string,
  type: string,
  dependencies: string[],
  affectedBy: string[],
): TaskRecord {
  return {
    id,
    type,
    stateVersion: state.version,
    dependencies,
    affectedBy,
    status: 'pending',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
