import { z } from 'zod';

export const SceneSourceSchema = z.enum(['generated_video', 'existing_asset']);

export const ProjectPhaseSchema = z.enum([
  'ASSET_PREP',
  'BRIEFING',
  'SCRIPT_REVIEW',
  'PRODUCING',
  'MIXING',
  'COMPLETED',
  'FAILED',
]);

export const SceneSchema = z.object({
  id: z.string().min(1),
  durationSec: z.number().positive(),
  narration: z.string().optional(),
  visualDescription: z.string().min(1),
  source: SceneSourceSchema,
  generationPrompt: z.string().optional(),
  assetQuery: z.string().optional(),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video']),
  uri: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'script', 'storyboard', 'preview']),
  uri: z.string().min(1),
  source: z.enum(['live', 'fallback', 'existing']),
  stateVersion: z.number().int().nonnegative(),
  sessionEpoch: z.number().int().nonnegative(),
});

export const TaskTraceValueSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  ref: z.string().optional(),
  summary: z.string(),
});

export const TaskTraceErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const TaskTraceSchema = z.object({
  inputs: z.array(TaskTraceValueSchema).default([]),
  outputs: z.array(TaskTraceValueSchema).default([]),
  downstream: z.array(z.string()).default([]),
  durationMs: z.number().nonnegative().optional(),
  attempt: z.number().int().positive().default(1),
  reusedFrom: z.string().optional(),
  error: TaskTraceErrorSchema.optional(),
});

export const TaskRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  dependencies: z.array(z.string()),
  affectedBy: z.array(z.string()),
  status: z.enum(['pending', 'running', 'completed', 'cancelled', 'stale', 'failed']),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  artifactIds: z.array(z.string()).optional(),
  trace: TaskTraceSchema.optional(),
});

export const ScriptAudioPlanSchema = z.object({
  bgm: z.object({
    style: z.string().min(1),
    intensity: z.string().min(1),
    assetId: z.string().optional(),
  }),
  soundEffects: z.array(z.object({
    atSec: z.number().nonnegative(),
    description: z.string().min(1),
    assetId: z.string().optional(),
  })).default([]),
  ducking: z.object({
    voiceoverDb: z.number(),
    bgmDb: z.number(),
  }),
});

export const ScriptShotSchema = z.object({
  order: z.number().int().positive(),
  id: z.string().min(1),
  durationSec: z.number().positive(),
  visualDescription: z.string().min(1),
  sourceDecision: z.object({
    kind: SceneSourceSchema,
    reason: z.string().min(1),
    candidates: z.array(z.string()).default([]),
  }),
  existingClip: z.object({
    assetId: z.string().min(1),
    startSec: z.number().nonnegative().optional(),
    endSec: z.number().positive().optional(),
  }).optional(),
  aigcPrompt: z.string().optional(),
  voiceover: z.string(),
  onScreenText: z.string().optional(),
  musicAndSfx: z.string(),
});

export const ScriptPlanSchema = z.object({
  voiceover: z.string().min(1),
  durationSec: z.number().positive(),
  language: z.string().min(1).default('zh-CN'),
  estimatedSeconds: z.number().positive().optional(),
  compliance: z.object({
    passed: z.boolean(),
    notes: z.array(z.string()),
  }).default({ passed: true, notes: [] }),
  audioPlan: ScriptAudioPlanSchema.default({
    bgm: { style: '轻快、克制', intensity: '低' },
    soundEffects: [],
    ducking: { voiceoverDb: -3, bgmDb: -16 },
  }),
  shots: z.array(ScriptShotSchema).default([]),
});

export const ProjectStateSchema = z.object({
  projectId: z.string().min(1).default('project_local'),
  version: z.number().int().nonnegative(),
  phase: ProjectPhaseSchema.default('BRIEFING'),
  brief: z.object({
    product: z.string().min(1),
    audience: z.string().min(1),
    platform: z.string().min(1),
    duration: z.number().positive(),
  }),
  creative: z.object({
    sellingPoint: z.string(),
    style: z.string(),
    tone: z.string(),
  }),
  script: ScriptPlanSchema.optional(),
  scenes: z.array(SceneSchema),
  assets: z.array(AssetSchema),
  generatedClips: z.array(ArtifactSchema),
  preview: ArtifactSchema.optional(),
});

export const IntentPatchSchema = z.object({
  patchId: z.string().min(1),
  baseVersion: z.number().int().nonnegative(),
  changes: z.record(z.string(), z.unknown()),
  userSummary: z.string().min(1),
});

export type Scene = z.infer<typeof SceneSchema>;
export type SceneSource = z.infer<typeof SceneSourceSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type AudioArtifact = Artifact & { type: 'audio' };
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type TaskTrace = z.infer<typeof TaskTraceSchema>;
export type ProjectPhase = z.infer<typeof ProjectPhaseSchema>;
export type ScriptPlan = z.infer<typeof ScriptPlanSchema>;
export type ScriptShot = z.infer<typeof ScriptShotSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type IntentPatch = z.infer<typeof IntentPatchSchema>;
