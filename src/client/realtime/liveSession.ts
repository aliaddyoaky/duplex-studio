import { GoogleGenAI } from '@google/genai';

import { createLiveConnectConfig, LIVE_API_VERSION } from '../../shared/liveConfig.js';
import {
  IntentPatchSchema,
  ProjectStateSchema,
  type IntentPatch,
  type ProjectState,
} from '../../shared/schemas.js';
import { BrowserAudioCapture, type AudioCaptureLike } from './audioCapture.js';
import { BrowserAudioPlayback, type AudioPlaybackLike } from './audioPlayback.js';

export interface LiveFunctionCallLike {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface LiveServerMessageLike {
  data?: string;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
  };
  toolCall?: { functionCalls?: LiveFunctionCallLike[] };
}

export interface LiveConnectionCallbacks {
  onMessage(message: LiveServerMessageLike): Promise<void> | void;
}

export interface LiveConnection {
  sendAudio(base64Pcm16: string, sampleRate: number): void;
  sendAudioStreamEnd(): void;
  sendToolResponse(response: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  }): void;
  close(): void;
}

export type LiveConnector = (options: {
  token: string;
  model: string;
  runtimeContext?: string;
  callbacks: LiveConnectionCallbacks;
}) => Promise<LiveConnection>;

export interface LiveSessionController {
  connect(): Promise<void>;
  startMic(): Promise<void>;
  stopMic(): void;
  disconnect(): void;
}

interface EphemeralTokenResponse {
  token: string;
  liveModel: string;
}

interface IntentPatchResponse {
  stateVersion: number;
  current?: {
    phase?: string;
    version?: number;
    brief?: ProjectState['brief'];
    creative?: ProjectState['creative'];
    script?: ProjectState['script'];
    scenes?: ProjectState['scenes'];
  };
}

interface CreateProjectResponse {
  stateVersion: number;
  current?: {
    phase?: string;
    version?: number;
    brief?: ProjectState['brief'];
    creative?: ProjectState['creative'];
    script?: ProjectState['script'];
    scenes?: ProjectState['scenes'];
  };
}

export interface ConfirmScriptResponse {
  stateVersion: number;
  phase?: string;
}

export interface CreateLiveSessionOptions {
  connect?: LiveConnector;
  audioCapture?: AudioCaptureLike;
  audioPlayback?: AudioPlaybackLike;
  getEphemeralToken?: (runtimeContext?: string) => Promise<EphemeralTokenResponse>;
  getStateVersion: () => number;
  getRuntimeContext?: () => string;
  postCreateProject?: (brief: ProjectState['brief']) => Promise<CreateProjectResponse>;
  postIntentPatch?: (patch: IntentPatch) => Promise<IntentPatchResponse>;
  postConfirmScript?: (scriptVersion: number) => Promise<ConfirmScriptResponse>;
  idFactory?: () => string;
  onTranscript?: (text: string, speaker: 'user' | 'agent') => void;
  onUserTurn?: (text: string, version: number) => void;
  onSpeaking?: (speaking: boolean) => void;
  onInterrupted?: () => void;
  onProjectCreated?: (stateVersion: number) => void;
  onIntentPatch?: (patch: IntentPatch, stateVersion: number) => void;
  onConfirmScript?: (stateVersion: number) => void;
}

export function createLiveSession(options: CreateLiveSessionOptions): LiveSessionController {
  const connector = options.connect ?? createGoogleLiveConnector();
  const capture = options.audioCapture ?? new BrowserAudioCapture(16_000);
  const playback = options.audioPlayback ?? new BrowserAudioPlayback(24_000);
  const getToken = options.getEphemeralToken ?? fetchEphemeralToken;
  const postProject = options.postCreateProject ?? postCreateProject;
  const postPatch = options.postIntentPatch ?? postIntentPatch;
  const postConfirm = options.postConfirmScript;
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  let connection: LiveConnection | undefined;
  let projectVersion = options.getStateVersion();
  let userTurn = '';
  let turnVersion = projectVersion;
  let turnHasEdit = false;

  const handleMessage = async (message: LiveServerMessageLike) => {
    const content = message.serverContent;
    if (content?.interrupted) {
      playback.clear();
      options.onSpeaking?.(false);
      options.onInterrupted?.();
    }

    const inputText = content?.inputTranscription?.text;
    if (inputText) {
      if (!userTurn) turnVersion = options.getStateVersion();
      // 转写流可能是增量片段，也可能是从头累积的完整句（以已有文本开头），两种都正确合并
      userTurn = userTurn && inputText.startsWith(userTurn) ? inputText : userTurn + inputText;
      options.onTranscript?.(inputText, 'user');
    }
    const outputText = content?.outputTranscription?.text;
    if (outputText) options.onTranscript?.(outputText, 'agent');

    const audio =
      message.data ??
      content?.modelTurn?.parts?.find((part) => part.inlineData?.mimeType?.startsWith('audio/'))
        ?.inlineData?.data;
    if (audio && !content?.interrupted) {
      playback.enqueueBase64(audio);
      options.onSpeaking?.(true);
    }
    if (content?.turnComplete) {
      options.onSpeaking?.(false);
      if (!turnHasEdit && !message.toolCall?.functionCalls?.length && userTurn) options.onUserTurn?.(userTurn, turnVersion);
      userTurn = '';
      turnHasEdit = false;
    }

    for (const functionCall of message.toolCall?.functionCalls ?? []) {
      turnHasEdit = true;
      // Runtime state is authoritative. This also covers reset/seed actions that happen
      // outside the Live session while the WebSocket stays connected.
      projectVersion = options.getStateVersion();
      if (functionCall.name === 'createProject') {
        try {
          if (projectVersion > 0) throw new Error('Project already exists; use applyIntentPatch');
          const brief = ProjectStateSchema.shape.brief.parse(functionCall.args);
          const result = await postProject(brief);
          projectVersion = result.stateVersion;
          options.onProjectCreated?.(projectVersion);
          connection?.sendToolResponse({
            id: functionCall.id,
            name: 'createProject',
            response: {
              ok: true,
              stateVersion: projectVersion,
              runtimeState: result.current ?? { phase: 'SCRIPT_REVIEW', brief },
            },
          });
        } catch (error) {
          connection?.sendToolResponse({
            id: functionCall.id,
            name: 'createProject',
            response: {
              ok: false,
              error: error instanceof Error ? error.message : 'Project creation failed',
            },
          });
        }
        continue;
      }
      if (functionCall.name === 'confirmScript') {
        try {
          if (!postConfirm) throw new Error('确认接口不可用，请点击“开始制作”按钮');
          const result = await postConfirm(options.getStateVersion());
          projectVersion = result.stateVersion;
          options.onConfirmScript?.(result.stateVersion);
          connection?.sendToolResponse({
            id: functionCall.id,
            name: 'confirmScript',
            response: {
              ok: true,
              stateVersion: result.stateVersion,
              runtimeState: { phase: result.phase ?? 'PRODUCING', version: result.stateVersion },
            },
          });
        } catch (error) {
          connection?.sendToolResponse({
            id: functionCall.id,
            name: 'confirmScript',
            response: {
              ok: false,
              error: error instanceof Error ? error.message : 'Script confirmation failed',
            },
          });
        }
        continue;
      }
      if (functionCall.name !== 'applyIntentPatch') continue;
      try {
        const patch = IntentPatchSchema.parse({
          patchId: idFactory(),
          baseVersion: projectVersion,
          changes: functionCall.args?.changes,
          userSummary: functionCall.args?.userSummary,
        });
        const result = await postPatch(patch);
        projectVersion = result.stateVersion;
        options.onIntentPatch?.(patch, projectVersion);
        connection?.sendToolResponse({
          id: functionCall.id,
          name: 'applyIntentPatch',
          response: {
            ok: true,
            stateVersion: projectVersion,
            runtimeState: result.current ?? { version: projectVersion },
          },
        });
      } catch (error) {
        connection?.sendToolResponse({
          id: functionCall.id,
          name: 'applyIntentPatch',
          response: {
            ok: false,
            error: error instanceof Error ? error.message : 'Intent patch failed',
          },
        });
      }
    }
  };

  return {
    async connect() {
      if (connection) return;
      projectVersion = options.getStateVersion();
      const runtimeContext = options.getRuntimeContext?.() ?? '';
      const session = await getToken(runtimeContext);
      connection = await connector({
        token: session.token,
        model: session.liveModel,
        runtimeContext,
        callbacks: { onMessage: handleMessage },
      });
    },

    async startMic() {
      if (!connection) throw new Error('Live session must connect before starting the microphone');
      await capture.start((base64Pcm16, sampleRate) => connection?.sendAudio(base64Pcm16, sampleRate));
    },

    stopMic() {
      capture.stop();
      connection?.sendAudioStreamEnd();
    },

    disconnect() {
      userTurn = '';
      turnHasEdit = false;
      capture.stop();
      playback.clear();
      connection?.close();
      connection = undefined;
    },
  };
}

export function createGoogleLiveConnector(): LiveConnector {
  return async ({ token, model, runtimeContext = '', callbacks }) => {
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: LIVE_API_VERSION } });
    const session = await ai.live.connect({
      model,
      config: createLiveConnectConfig(runtimeContext),
      callbacks: {
        onmessage: (message) => {
          void callbacks.onMessage(message as LiveServerMessageLike);
        },
      },
    });
    return {
      sendAudio(base64Pcm16, sampleRate) {
        session.sendRealtimeInput({
          audio: { data: base64Pcm16, mimeType: `audio/pcm;rate=${sampleRate}` },
        });
      },
      sendAudioStreamEnd() {
        session.sendRealtimeInput({ audioStreamEnd: true });
      },
      sendToolResponse(response) {
        session.sendToolResponse({ functionResponses: response });
      },
      close() {
        session.close();
      },
    };
  };
}

async function fetchEphemeralToken(runtimeContext = ''): Promise<EphemeralTokenResponse> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runtimeContext }),
  });
  if (!response.ok) throw new Error(`Could not create Live session (${response.status})`);
  return (await response.json()) as EphemeralTokenResponse;
}

async function postCreateProject(brief: ProjectState['brief']): Promise<CreateProjectResponse> {
  const response = await fetch('/api/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(brief),
  });
  if (!response.ok) throw new Error(`Project creation failed (${response.status})`);
  const body = (await response.json()) as CreateProjectResponse & { version?: number };
  if (typeof body.version !== 'number') throw new Error('Project creation response omitted version');
  return { stateVersion: body.version, current: body as CreateProjectResponse['current'] };
}

async function postIntentPatch(patch: IntentPatch): Promise<IntentPatchResponse> {
  const response = await fetch('/api/intent/patch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Intent patch failed (${response.status})`);
  const body = (await response.json()) as IntentPatchResponse & { stateVersion?: number };
  const stateVersion = body.stateVersion ?? body.current?.version;
  if (typeof stateVersion !== 'number') throw new Error('Intent patch response omitted stateVersion');
  return { stateVersion, current: body.current };
}
