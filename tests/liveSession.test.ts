import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.js';
import { float32ToPcm16Base64, resampleLinear } from '../src/client/realtime/audioCapture.js';
import { LIVE_API_VERSION } from '../src/shared/liveConfig.js';
import {
  GeminiLiveTokenProvider,
  type LiveTokenClient,
} from '../src/server/providers/liveTokenProvider.js';
import {
  createLiveSession,
  type LiveConnection,
  type LiveConnectionCallbacks,
  type LiveConnector,
} from '../src/client/realtime/liveSession.js';
import { isExplicitStartCommand } from '../src/client/components/RealtimePanel.js';

describe('Gemini Live ephemeral session', () => {
  it('requires an explicit positive confirmation phrase', () => {
    expect(isExplicitStartCommand('开始制作')).toBe(true);
    expect(isExplicitStartCommand('确认并开始制作')).toBe(true);
    expect(isExplicitStartCommand('好的，开始制作吧')).toBe(true);
    expect(isExplicitStartCommand('可以，确认脚本，开始吧')).toBe(true);
    expect(isExplicitStartCommand('那就开工吧')).toBe(true);
    expect(isExplicitStartCommand('先不要开始制作')).toBe(false);
    expect(isExplicitStartCommand('还不开始')).toBe(false);
    expect(isExplicitStartCommand('第三个镜头别生成了，换成真实素材')).toBe(false);
    expect(isExplicitStartCommand('从头开始写脚本')).toBe(false);
    expect(isExplicitStartCommand('等一下再开始制作')).toBe(false);
    expect(isExplicitStartCommand('这个开头可以再口语化一点吗')).toBe(false);
  });
  it('uses the v1beta endpoint required by current ephemeral Live tokens', () => {
    expect(LIVE_API_VERSION).toBe('v1beta');
  });

  it('encodes microphone samples as little-endian PCM16 and can target 16 kHz', () => {
    const encoded = float32ToPcm16Base64(new Float32Array([-1, 0, 1]));
    expect(Array.from(Buffer.from(encoded, 'base64'))).toEqual([0, 128, 0, 0, 255, 127]);
    expect(resampleLinear(new Float32Array(48), 48_000, 16_000)).toHaveLength(16);
  });

  it('mints a one-use token locked to gemini-3.8-live and exposes no long-lived key', async () => {
    let tokenRequest: unknown;
    const client: LiveTokenClient = {
      create: async (request) => {
        tokenRequest = request;
        return { name: 'auth_tokens/ephemeral-123' };
      },
    };
    const provider = new GeminiLiveTokenProvider({ apiKey: 'server-secret', client });

    const response = await request(createApp({ liveTokenProvider: provider }))
      .post('/api/session')
      .expect(201);

    expect(tokenRequest).toMatchObject({
      config: {
        uses: 1,
        liveConnectConstraints: {
          model: 'gemini-3.8-live',
          config: {
            responseModalities: ['AUDIO'],
            tools: [{ functionDeclarations: expect.arrayContaining([
              expect.objectContaining({ name: 'createProject' }),
              expect.objectContaining({ name: 'applyIntentPatch' }),
              expect.objectContaining({ name: 'confirmScript' }),
            ]) }],
          },
        },
      },
    });
    expect(response.body).toEqual({
      token: 'auth_tokens/ephemeral-123',
      liveModel: 'gemini-3.8-live',
    });
    expect(JSON.stringify(response.body)).not.toContain('server-secret');
  });

  it('clears queued model audio immediately when the server reports an interruption', async () => {
    const harness = createHarness();
    const onInterrupted = vi.fn();
    const controller = createLiveSession({ ...harness.options, onInterrupted });

    await controller.connect();
    harness.callbacks?.onMessage({ serverContent: { interrupted: true } });

    expect(harness.audioPlayback.clear).toHaveBeenCalledOnce();
    expect(onInterrupted).toHaveBeenCalledOnce();
  });

  it('turns applyIntentPatch into a structured Runtime API call and acknowledges the tool', async () => {
    const harness = createHarness();
    const controller = createLiveSession(harness.options);
    await controller.connect();

    await harness.callbacks?.onMessage({
      toolCall: {
        functionCalls: [
          {
            id: 'call-1',
            name: 'applyIntentPatch',
            args: {
              changes: { 'creative.tone': 'more authentic, less commercial' },
              userSummary: '更真实一点，别那么广告',
            },
          },
        ],
      },
    });

    expect(harness.postIntentPatch).toHaveBeenCalledWith({
      patchId: 'patch-test',
      baseVersion: 7,
      changes: { 'creative.tone': 'more authentic, less commercial' },
      userSummary: '更真实一点，别那么广告',
    });
    expect(harness.connection.sendToolResponse).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'applyIntentPatch',
      response: expect.objectContaining({
        ok: true,
        stateVersion: 8,
        runtimeState: { phase: 'SCRIPT_REVIEW', version: 8 },
      }),
    });
  });

  it('turns an explicit voice confirmation into the confirm-script Runtime call', async () => {
    const harness = createHarness();
    const onConfirmScript = vi.fn();
    const controller = createLiveSession({ ...harness.options, onConfirmScript });
    await controller.connect();

    await harness.callbacks?.onMessage({
      toolCall: {
        functionCalls: [{ id: 'call-confirm', name: 'confirmScript', args: {} }],
      },
    });

    expect(harness.postConfirmScript).toHaveBeenCalledWith(7);
    expect(onConfirmScript).toHaveBeenCalledWith(3);
    expect(harness.connection.sendToolResponse).toHaveBeenCalledWith({
      id: 'call-confirm',
      name: 'confirmScript',
      response: expect.objectContaining({ ok: true, stateVersion: 3, runtimeState: { phase: 'PRODUCING', version: 3 } }),
    });
  });

  it('reports confirm-script failures back to the voice model instead of throwing', async () => {
    const harness = createHarness();
    harness.postConfirmScript.mockRejectedValueOnce(new Error('脚本版本已变化，请确认最新版本'));
    const controller = createLiveSession(harness.options);
    await controller.connect();

    await harness.callbacks?.onMessage({
      toolCall: { functionCalls: [{ id: 'call-confirm-fail', name: 'confirmScript', args: {} }] },
    });

    expect(harness.connection.sendToolResponse).toHaveBeenCalledWith({
      id: 'call-confirm-fail',
      name: 'confirmScript',
      response: expect.objectContaining({ ok: false, error: '脚本版本已变化，请确认最新版本' }),
    });
  });

  it('syncs patch baseVersion from Runtime when a fallback seed happened after Live connected', async () => {
    const harness = createHarness(0);
    const controller = createLiveSession(harness.options);
    await controller.connect();
    harness.getStateVersion.mockReturnValue(1);

    await harness.callbacks?.onMessage({
      toolCall: { functionCalls: [{
        id: 'call-after-seed',
        name: 'applyIntentPatch',
        args: { changes: { 'creative.tone': 'authentic' }, userSummary: '真实一点' },
      }] },
    });

    expect(harness.postIntentPatch).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 1 }));
  });

  it('turns the first voice brief into createProject and advances Runtime to v1', async () => {
    const harness = createHarness(0);
    const controller = createLiveSession(harness.options);
    await controller.connect();

    await harness.callbacks?.onMessage({
      toolCall: {
        functionCalls: [{
          id: 'call-create',
          name: 'createProject',
          args: { product: '低糖气泡咖啡', audience: '大学生', platform: 'douyin', duration: 15 },
        }],
      },
    });

    expect(harness.postCreateProject).toHaveBeenCalledWith({
      product: '低糖气泡咖啡', audience: '大学生', platform: 'douyin', duration: 15,
    });
    expect(harness.connection.sendToolResponse).toHaveBeenCalledWith({
      id: 'call-create', name: 'createProject',
      response: expect.objectContaining({
        ok: true,
        stateVersion: 1,
        runtimeState: { phase: 'SCRIPT_REVIEW', version: 1 },
      }),
    });
  });

  it('reconnects with a new Live connection while keeping Runtime project state external', async () => {
    const harness = createHarness();
    const controller = createLiveSession(harness.options);

    await controller.connect();
    controller.disconnect();
    await controller.connect();

    expect(harness.getEphemeralToken).toHaveBeenCalledTimes(2);
    expect(harness.connect).toHaveBeenCalledTimes(2);
    expect(harness.getStateVersion).toHaveBeenCalled();
    expect(harness.connection.close).toHaveBeenCalledOnce();
  });

  it('passes the current System 2 snapshot into a new System 1 connection', async () => {
    const harness = createHarness();
    const controller = createLiveSession({ ...harness.options, getRuntimeContext: () => '{"phase":"SCRIPT_REVIEW","version":3}' });
    await controller.connect();
    expect(harness.connect).toHaveBeenCalledWith(expect.objectContaining({
      runtimeContext: '{"phase":"SCRIPT_REVIEW","version":3}',
    }));
  });
});

function createHarness(stateVersion = 7) {
  let callbacks: LiveConnectionCallbacks | undefined;
  const connection: LiveConnection = {
    sendAudio: vi.fn(),
    sendAudioStreamEnd: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  };
  const connect: LiveConnector = vi.fn(async (options) => {
    callbacks = options.callbacks;
    return connection;
  });
  const audioPlayback = { enqueueBase64: vi.fn(), clear: vi.fn(), close: vi.fn() };
  const getEphemeralToken = vi.fn(async () => ({
    token: 'ephemeral',
    liveModel: 'gemini-3.8-live',
  }));
  const getStateVersion = vi.fn(() => stateVersion);
  const postCreateProject = vi.fn(async () => ({
    stateVersion: 1,
    current: { phase: 'SCRIPT_REVIEW', version: 1 },
  }));
  const postIntentPatch = vi.fn(async () => ({
    stateVersion: 8,
    current: { phase: 'SCRIPT_REVIEW', version: 8 },
  }));
  const postConfirmScript = vi.fn(async () => ({ stateVersion: 3, phase: 'PRODUCING' }));

  return {
    get callbacks() {
      return callbacks;
    },
    connection,
    connect,
    audioPlayback,
    getEphemeralToken,
    getStateVersion,
    postCreateProject,
    postIntentPatch,
    postConfirmScript,
    options: {
      connect,
      audioCapture: { start: vi.fn(), stop: vi.fn() },
      audioPlayback,
      getEphemeralToken,
      getStateVersion,
      postCreateProject,
      postIntentPatch,
      postConfirmScript,
      idFactory: () => 'patch-test',
    },
  };
}
