import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { generateVideoWithFallback } from '../src/server/demo/fallback.js';
import {
  MiniMaxVideoProvider,
  VideoGenerationError,
  type MiniMaxVideoClient,
} from '../src/server/providers/videoProvider.js';

const validMp4 = Buffer.from('00000018667479706d70343200000000', 'hex');

function input() {
  return {
    prompt: 'authentic college campus coffee vlog',
    aspectRatio: '9:16' as const,
    resolution: '720p' as const,
    stateVersion: 2,
    sessionEpoch: 3,
  };
}

describe('MiniMax H3 Max video provider', () => {
  it('requests portrait 768P H3 Max video and persists the downloaded mp4', async () => {
    let createBody: unknown;
    const client: MiniMaxVideoClient = {
      create: async (body) => {
        createBody = body;
        return { task_id: 'task_001' };
      },
      query: async () => ({
        task: { id: 'task_001', status: 'succeeded', content: { url: 'https://cdn.example/clip.mp4' } },
      }),
      download: async () => validMp4,
      cancel: async () => undefined,
    };
    const outputDir = await mkdtemp(join(tmpdir(), 'duplex-video-'));
    const provider = new MiniMaxVideoProvider({
      apiKey: 'test-key',
      client,
      outputDir,
      idFactory: () => 'clip_001',
    });

    const artifact = await provider.generate(input());

    expect(createBody).toEqual({
      model: 'MiniMax-H3-Max',
      content: [{ type: 'text', text: 'authentic college campus coffee vlog' }],
      resolution: '768P',
      duration: 5,
      ratio: '9:16',
    });
    expect(artifact).toMatchObject({
      id: 'clip_001',
      type: 'video',
      source: 'live',
      stateVersion: 2,
      sessionEpoch: 3,
    });
    expect(await readFile(artifact.uri)).toEqual(validMp4);
  });

  it('uses the configured regional API host for video requests', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/v2/video_generation')) {
        return new Response(JSON.stringify({ task_id: 'task_host' }), { status: 200 });
      }
      if (url.includes('/v2/query/video_generation/')) {
        return new Response(
          JSON.stringify({
            task: { id: 'task_host', status: 'succeeded', content: { url: 'https://cdn.example/clip.mp4' } },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://cdn.example/clip.mp4') return new Response(validMp4, { status: 200 });
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as unknown as typeof fetch;

    try {
      const outputDir = await mkdtemp(join(tmpdir(), 'duplex-video-host-'));
      const provider = new MiniMaxVideoProvider({
        apiKey: 'test-key',
        apiHost: 'https://api.minimaxi.com',
        outputDir,
        idFactory: () => 'clip_host',
      });

      await provider.generate(input());
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      'https://api.minimaxi.com/v2/video_generation',
      'https://api.minimaxi.com/v2/query/video_generation/task_host',
      'https://cdn.example/clip.mp4',
    ]);
  });

  it('returns a typed failure when a succeeded task has no download URL', async () => {
    const client: MiniMaxVideoClient = {
      create: async () => ({ task_id: 'task_002' }),
      query: async () => ({ task: { id: 'task_002', status: 'succeeded', content: {} } }),
      download: async () => validMp4,
      cancel: async () => undefined,
    };
    const provider = new MiniMaxVideoProvider({ apiKey: 'test-key', client });

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'VIDEO_OUTPUT_MISSING',
    } satisfies Partial<VideoGenerationError>);
  });

  it('returns a typed failure when MiniMax reports a failed task', async () => {
    const client: MiniMaxVideoClient = {
      create: async () => ({ task_id: 'task_003' }),
      query: async () => ({ task: { id: 'task_003', status: 'failed', error: { message: 'blocked' } } }),
      download: async () => validMp4,
      cancel: async () => undefined,
    };
    const provider = new MiniMaxVideoProvider({ apiKey: 'test-key', client });

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'VIDEO_OUTPUT_MISSING',
    } satisfies Partial<VideoGenerationError>);
  });

  it('best-effort cancels the MiniMax task when the runtime aborts a queued generation', async () => {
    const controller = new AbortController();
    let cancelledTaskId = '';
    const client: MiniMaxVideoClient = {
      create: async () => ({ task_id: 'task_004' }),
      query: async () => {
        controller.abort();
        return { task: { id: 'task_004', status: 'queued' } };
      },
      download: async () => validMp4,
      cancel: async (taskId) => {
        cancelledTaskId = taskId;
      },
    };
    const provider = new MiniMaxVideoProvider({
      apiKey: 'test-key',
      client,
      pollIntervalMs: 1,
    });

    await expect(provider.generate(input(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(cancelledTaskId).toBe('task_004');
  });

  it('marks cached hybrid output as fallback rather than live', async () => {
    const failing = {
      generate: async () => {
        throw new VideoGenerationError('VIDEO_OUTPUT_MISSING', 'no video');
      },
    };
    const fallback = {
      id: 'cached_scene_1',
      type: 'video' as const,
      uri: 'demo/assets/campus_product_coffee.mp4',
      source: 'live' as const,
      stateVersion: 1,
      sessionEpoch: 1,
    };

    const artifact = await generateVideoWithFallback('HYBRID', failing, input(), fallback);
    expect(artifact).toMatchObject({
      id: 'cached_scene_1',
      source: 'fallback',
      stateVersion: 2,
      sessionEpoch: 3,
    });
  });
});
