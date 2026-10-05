import { z } from 'zod';

import { SceneSchema, ScriptPlanSchema, type ProjectState } from '../../shared/schemas.js';

export const PlannedSceneSchema = SceneSchema.extend({
  needsImageReference: z.boolean().default(false),
});

export const CreativePlanSchema = z.object({
  constraints: z.object({
    platform: z.string().min(1),
    sellingPoint: z.string(),
    style: z.string(),
    duration: z.number().positive(),
  }),
  strategy: z.object({
    hook: z.string().min(1),
    rationale: z.string().min(1),
  }),
  script: ScriptPlanSchema,
  scenes: z.array(PlannedSceneSchema).length(4),
});

export type CreativePlan = z.infer<typeof CreativePlanSchema>;
export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

export function buildPlannerPrompt(state: ProjectState, repairFeedback?: string): string {
  const authoritativeState = JSON.stringify(
    {
      version: state.version,
      brief: state.brief,
      creative: state.creative,
      existingScenes: state.scenes,
      availableAssets: state.assets,
    },
    null,
    2,
  );
  return [
    'You are the System 2 Creative Brain for a realtime short-video creation agent.',
    'The Project State below is authoritative. Never prefer older conversational context over it.',
    'Return exactly four scenes and preserve every explicit constraint in the constraints object.',
    'Choose source=generated_video for scenes worth generating and existing_asset when real product footage is preferable.',
    'Return a structured script with one unified audioPlan and a shot entry for every scene; never attach BGM or SFX to generated video output.',
    'Use the availableAssets catalog and prefer matching user-uploaded video assets when they are semantically compatible. When the catalog contains uploaded videos, at least half of the scenes must reuse existing assets unless a shot genuinely needs synthetic visuals; reserve generated_video for product hero shots or scenes the catalog cannot plausibly cover. A usable source clip may be longer or shorter than the target shot: choose a trim range when the source can cover at least 70% of the shot, and allow speed adjustment or a small loop rather than rejecting it for an exact-duration mismatch. Keep shot ids equal to scene ids, shot order and durations aligned. Include a source reason, existingClip.assetId and trim range or aigcPrompt. Do not invent asset ids. All descriptions, reasons, narration and directions must be in Chinese.',
    authoritativeState,
    repairFeedback ? `Previous plan validation failed. Repair this issue: ${repairFeedback}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
