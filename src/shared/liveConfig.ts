import { Behavior, Modality, type LiveConnectConfig } from '@google/genai';

export const LIVE_MODEL = 'gemini-3.8-live' as const;
export const LIVE_API_VERSION = 'v1beta' as const;

export const CREATE_PROJECT_DECLARATION = {
  name: 'createProject',
  description:
    'Create the initial creative project from the user first brief. Call this once before applyIntentPatch.',
  behavior: Behavior.NON_BLOCKING,
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['product', 'audience', 'platform', 'duration'],
    properties: {
      product: { type: 'string', description: 'Product being advertised.' },
      audience: { type: 'string', description: 'Target audience.' },
      platform: { type: 'string', description: 'Target platform, for example douyin.' },
      duration: { type: 'number', description: 'Target video duration in seconds.' },
    },
  },
} as const;

export const APPLY_INTENT_PATCH_DECLARATION = {
  name: 'applyIntentPatch',
  description:
    'Commit a structured change to the existing creative project when the user changes or corrects the brief, creative direction, script, shot, narration, source decision, timing, BGM or SFX. Always call this tool for a concrete requested edit instead of only acknowledging it. Use dotted ProjectState paths such as creative.tone, script.voiceover, script.shots.scene_2.voiceover, scenes.scene_2.visualDescription, scenes.scene_2.source, or scenes.scene_2.durationSec. Do not mutate project state yourself.',
  behavior: Behavior.NON_BLOCKING,
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['changes', 'userSummary'],
    properties: {
      changes: {
        type: 'object',
        description: 'Dotted ProjectState field paths mapped to their new values. For script shot edits use the shot id, for example script.shots.scene_2.voiceover or script.shots.scene_2.visualDescription.',
        additionalProperties: true,
      },
      userSummary: {
        type: 'string',
        description: 'Short faithful summary of the requested change in the user language.',
      },
    },
  },
} as const;

export const CONFIRM_SCRIPT_DECLARATION = {
  name: 'confirmScript',
  description:
    'Commit the user\'s explicit approval of the current script and start production. Call this only when the user clearly confirms the script or asks to start making the video (e.g. 开始制作 / 确认脚本 / 开始吧 / 可以开始 / 开工). A question, an edit request, or a vague acknowledgement is never a confirmation.',
  behavior: Behavior.NON_BLOCKING,
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const;

export function createLiveConnectConfig(runtimeContext = ''): LiveConnectConfig {
  const contextInstruction = runtimeContext.trim()
    ? `The following Runtime State snapshot is authoritative and must be used to answer status questions. Do not ask what to make when a project already exists.\n${runtimeContext}`
    : 'If a project already exists, use the Runtime State returned by your tools and ask for the current snapshot instead of restarting discovery.';
  return {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: [
      'You are the realtime System 1 voice layer of Duplex Studio.',
      'Respond briefly and naturally while the Creative Brain works in parallel.',
      'For the first creative brief, call createProject once to create Runtime State v1.',
      'For later changes, call applyIntentPatch with only structured changes and a short summary.',
      'If the user says change, revise, replace, shorten, lengthen, rewrite, use this material, remove, add, or make a shot/voiceover/BGM different, call applyIntentPatch immediately with the affected dotted paths. Do not merely say you will change it.',
      'When the user explicitly confirms the script or asks to start production (开始制作 / 确认脚本 / 开始吧 / 可以开始 / 开工 or equivalent), call confirmScript immediately so production starts without any manual button click. Only call it on that explicit confirmation; a question, an edit request, or acknowledging a suggestion is never a confirmation.',
      'After a successful tool response, summarize the exact fields changed and the new project phase/version.',
      'Never edit phase, version, projectId, generatedClips or preview. Production requires an explicit user confirmation after reviewing the latest script; an edit is never confirmation. Use the actual shot ids from Runtime State, not example ids.',
      'Never claim that a project edit, asset, or video is finished until Runtime state confirms it.',
      'When the project is in SCRIPT_REVIEW, discuss and edit the existing script instead of asking for a new brief.',
      'When the project is PRODUCING or MIXING, report the current tasks and require a new script review after any material change.',
      contextInstruction,
    ].join(' '),
    tools: [{ functionDeclarations: [CREATE_PROJECT_DECLARATION, APPLY_INTENT_PATCH_DECLARATION, CONFIRM_SCRIPT_DECLARATION] }],
  };
}
