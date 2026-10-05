import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Artifact } from '../../shared/schemas.js';

export interface VideoGenerationInput {
  prompt: string;
  aspectRatio: '9:16';
  resolution: '720p';
  stateVersion: number;
  sessionEpoch: number;
}

export type VideoArtifact = Artifact & { type: 'video' };

export interface VideoProvider {
  generate(input: VideoGenerationInput, signal?: AbortSignal): Promise<VideoArtifact>;
}

export type MiniMaxTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface MiniMaxTaskResponse {
  task: {
    id: string;
    status: MiniMaxTaskStatus;
    content?: { url?: string };
    error?: unknown;
  };
}

export interface MiniMaxVideoClient {
  create(
    body: {
      model: string;
      content: Array<{ type: 'text'; text: string }>;
      resolution: '768P';
      duration: 5;
      ratio: '9:16';
    },
    signal?: AbortSignal,
  ): Promise<{ task_id: string }>;
  query(taskId: string, signal?: AbortSignal): Promise<MiniMaxTaskResponse>;
  download(url: string, signal?: AbortSignal): Promise<Buffer>;
  cancel(taskId: string): Promise<void>;
}

export type VideoGenerationErrorCode =
  | 'VIDEO_GENERATION_TIMEOUT'
  | 'VIDEO_OUTPUT_MISSING'
  | 'VIDEO_OUTPUT_INVALID';

export class VideoGenerationError extends Error {
  constructor(
    readonly code: VideoGenerationErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VideoGenerationError';
  }
}

export interface MiniMaxVideoProviderOptions {
  apiKey: string;
  apiHost?: string;
  model?: string;
  client?: MiniMaxVideoClient;
  outputDir?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  idFactory?: () => string;
}

function isMp4(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

async function jsonOrThrow(response: Response, provider: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${provider} API ${response.status}: ${detail || response.statusText}`);
  }
  return response.json();
}

function createMiniMaxClient(apiKey: string, apiHost = 'https://api.minimax.io'): MiniMaxVideoClient {
  const baseUrl = apiHost.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${apiKey}` };
  return {
    create: async (body, signal) => {
      const response = await fetch(`${baseUrl}/v2/video_generation`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return (await jsonOrThrow(response, 'MiniMax')) as { task_id: string };
    },
    query: async (taskId, signal) => {
      const response = await fetch(`${baseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
        headers,
        signal,
      });
      return (await jsonOrThrow(response, 'MiniMax')) as MiniMaxTaskResponse;
    },
    download: async (url, signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`MiniMax video download ${response.status}: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    },
    cancel: async (taskId) => {
      const response = await fetch(`${baseUrl}/v2/video_generation/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok && response.status !== 400) await jsonOrThrow(response, 'MiniMax');
    },
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(resolveWait, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export class MiniMaxVideoProvider implements VideoProvider {
  private readonly client: MiniMaxVideoClient;
  private readonly model: string;
  private readonly outputDir: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly idFactory: () => string;

  constructor(options: MiniMaxVideoProviderOptions) {
    this.model = options.model ?? 'MiniMax-H3-Max';
    this.client = options.client ?? createMiniMaxClient(options.apiKey, options.apiHost);
    this.outputDir = options.outputDir ?? resolve('data/artifacts');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.idFactory = options.idFactory ?? (() => `video_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
  }

  async generate(input: VideoGenerationInput, signal?: AbortSignal): Promise<VideoArtifact> {
    const startedAt = Date.now();
    const created = await this.client.create(
      {
        model: this.model,
        content: [{ type: 'text', text: input.prompt }],
        resolution: '768P',
        duration: 5,
        ratio: input.aspectRatio,
      },
      signal,
    );

    try {
      while (true) {
        if (Date.now() - startedAt >= this.timeoutMs) {
          throw new VideoGenerationError('VIDEO_GENERATION_TIMEOUT', 'MiniMax video generation timed out');
        }
        const response = await this.client.query(created.task_id, signal);
        const { task } = response;
        if (task.status === 'succeeded') {
          const url = task.content?.url;
          if (!url) {
            throw new VideoGenerationError('VIDEO_OUTPUT_MISSING', 'MiniMax succeeded without a video download URL');
          }
          const bytes = await this.client.download(url, signal);
          if (!isMp4(bytes)) {
            throw new VideoGenerationError('VIDEO_OUTPUT_INVALID', 'MiniMax returned invalid mp4 bytes');
          }
          await mkdir(this.outputDir, { recursive: true });
          const id = this.idFactory();
          const uri = resolve(this.outputDir, `${id}.mp4`);
          await writeFile(uri, bytes);
          return {
            id,
            type: 'video',
            uri,
            source: 'live',
            stateVersion: input.stateVersion,
            sessionEpoch: input.sessionEpoch,
          };
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
          throw new VideoGenerationError('VIDEO_OUTPUT_MISSING', `MiniMax video task ${task.status}`, task.error);
        }
        await wait(this.pollIntervalMs, signal);
      }
    } catch (error) {
      if (signal?.aborted) {
        await this.client.cancel(created.task_id).catch(() => undefined);
      }
      throw error;
    }
  }
}
