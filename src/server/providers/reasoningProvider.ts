import { z } from 'zod';

import type { ProjectState } from '../../shared/schemas.js';
import { CreativePlanSchema, buildPlannerPrompt, type CreativePlan } from '../tools/creativeTools.js';

export interface PlannerContext {
  reason: 'initial' | 'patch';
  conversationSummary?: string;
}

export interface ReasoningInput {
  state: ProjectState;
  context: PlannerContext;
  repairFeedback?: string;
}

export interface ReasoningProvider {
  plan(input: ReasoningInput): Promise<CreativePlan>;
}

export type DeepSeekReasoningEffort = 'none' | 'low' | 'high' | 'max';

export interface DeepSeekResponse {
  status: string;
  output: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
}

export interface DeepSeekResponsesClient {
  create(body: {
    model: string;
    input: string;
    reasoning: { effort: DeepSeekReasoningEffort };
    text: {
      format: {
        type: 'json_schema';
        name: 'creative_plan';
        schema: Record<string, unknown>;
      };
    };
  }): Promise<DeepSeekResponse>;
}

export interface DeepSeekReasoningProviderOptions {
  apiKey: string;
  model?: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  client?: DeepSeekResponsesClient;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek API ${response.status}: ${detail || response.statusText}`);
  }
  return response.json();
}

export class DeepSeekReasoningProvider implements ReasoningProvider {
  private readonly model: string;
  private readonly reasoningEffort: DeepSeekReasoningEffort;
  private readonly client: DeepSeekResponsesClient;

  constructor(options: DeepSeekReasoningProviderOptions) {
    this.model = options.model ?? 'deepseek-v4-pro';
    this.reasoningEffort = options.reasoningEffort ?? 'low';
    this.client =
      options.client ??
      ({
        create: async (body) => {
          const response = await fetch('https://api.deepseek.com/responses', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          return (await parseJsonResponse(response)) as DeepSeekResponse;
        },
      } satisfies DeepSeekResponsesClient);
  }

  async plan(input: ReasoningInput): Promise<CreativePlan> {
    const response = await this.client.create({
      model: this.model,
      input: buildPlannerPrompt(input.state, input.repairFeedback),
      reasoning: { effort: this.reasoningEffort },
      text: {
        format: {
          type: 'json_schema',
          name: 'creative_plan',
          schema: z.toJSONSchema(CreativePlanSchema) as Record<string, unknown>,
        },
      },
    });

    const outputText = response.output
      .find((item) => item.type === 'message')
      ?.content?.find((part) => part.type === 'output_text')?.text;
    if (!outputText) throw new Error('DeepSeek reasoning model returned no output_text CreativePlan');
    return CreativePlanSchema.parse(JSON.parse(outputText));
  }
}
