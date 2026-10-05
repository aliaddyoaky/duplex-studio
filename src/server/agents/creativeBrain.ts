import type { ProjectState } from '../../shared/schemas.js';
import type { PlannerContext, ReasoningProvider } from '../providers/reasoningProvider.js';
import { CreativePlanSchema, type CreativePlan } from '../tools/creativeTools.js';

function constraintError(state: ProjectState, plan: CreativePlan): string | null {
  const expected = {
    platform: state.brief.platform,
    sellingPoint: state.creative.sellingPoint,
    style: state.creative.style,
    duration: state.brief.duration,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((key === 'sellingPoint' || key === 'style') && value === '') continue;
    if (plan.constraints[key as keyof typeof expected] !== value) {
      return `Creative plan constraints do not match current Project State: ${key}`;
    }
  }
  return null;
}

export class CreativeBrain {
  readonly modelLabel: string;

  constructor(private readonly provider: ReasoningProvider, modelLabel = 'DeepSeek reasoning provider') {
    this.modelLabel = modelLabel.includes('API') ? modelLabel : `DeepSeek ${modelLabel} · Responses API`;
  }

  async plan(state: ProjectState, context: PlannerContext): Promise<CreativePlan> {
    let feedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.provider.plan({
          state: structuredClone(state),
          context,
          repairFeedback: feedback,
        });
        const parsed = CreativePlanSchema.safeParse(raw);
        if (!parsed.success) {
          feedback = parsed.error.issues.map((issue) => issue.message).join('; ');
          if (attempt === 1) throw new Error(`Invalid creative plan: ${feedback}`);
          continue;
        }
        const mismatch = constraintError(state, parsed.data);
        if (mismatch) {
          feedback = mismatch;
          if (attempt === 1) throw new Error(mismatch);
          continue;
        }
        return parsed.data;
      } catch (error) {
        if (attempt === 1) throw error;
        feedback = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`Invalid creative plan: ${feedback ?? 'unknown validation failure'}`);
  }
}
