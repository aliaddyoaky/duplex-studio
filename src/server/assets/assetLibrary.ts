import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Asset } from '../../shared/schemas.js';
import { searchAssets, type AssetManifestEntry, type AssetMatch } from '../tools/assetSearch.js';
import type { VisionProvider } from '../providers/visionProvider.js';
import { analysisWindows, cutVideo } from './videoEditing.js';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_MIME = /^(video|image|audio)\//;
const execFileAsync = promisify(execFile);

export class AssetLibraryError extends Error {
  constructor(public readonly code: 'UNSUPPORTED_MIME' | 'FILE_TOO_LARGE' | 'INVALID_FILENAME' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'AssetLibraryError';
  }
}

export interface AssetUploadInput {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface AssetListFilters {
  query?: string;
  type?: Asset['type'];
}

export interface AssetLibraryOptions {
  storageDir?: string;
  metadataPath?: string;
  visionProvider?: VisionProvider;
}

function assetType(mimeType: string): Asset['type'] {
  return mimeType.split('/')[0] as Asset['type'];
}

function safeFilename(filename: string): string {
  const base = basename(filename).trim();
  const safe = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+$/, '')
    .replace(/^[-_.]+(?=\.)/, '');
  if (!safe || safe === '.' || safe === '..') throw new AssetLibraryError('INVALID_FILENAME', 'A safe filename is required');
  return safe.slice(0, 180);
}

export class AssetLibrary {
  readonly storageDir: string;
  readonly metadataPath: string;
  private readonly visionProvider?: VisionProvider;
  private assets: Asset[] | null = null;

  constructor(options: AssetLibraryOptions = {}) {
    this.storageDir = resolve(options.storageDir ?? 'data/uploads');
    this.metadataPath = resolve(options.metadataPath ?? 'data/library.json');
    this.visionProvider = options.visionProvider;
  }

  async upload(input: AssetUploadInput): Promise<Asset> {
    if (!ALLOWED_MIME.test(input.mimeType)) {
      throw new AssetLibraryError('UNSUPPORTED_MIME', `Unsupported upload type: ${input.mimeType}`);
    }
    if (!Buffer.isBuffer(input.bytes)) throw new AssetLibraryError('FILE_TOO_LARGE', 'Upload body must be bytes');
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      throw new AssetLibraryError('FILE_TOO_LARGE', `Upload exceeds ${MAX_UPLOAD_BYTES} bytes`);
    }
    const filename = safeFilename(input.filename);
    await this.load();
    const checksum = createHash('sha256').update(input.bytes).digest('hex');
    const type = assetType(input.mimeType);
    const existing = this.assets!.find((asset) => asset.checksum === checksum && asset.type === type);
    if (existing) return structuredClone(existing);

    const id = `upload_${checksum.slice(0, 16)}`;
    const storedName = `${id}-${filename}`;
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(join(this.storageDir, storedName), input.bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const asset: Asset = {
      id,
      type,
      uri: `/media/uploads/${storedName}`,
      tags: [],
      filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      checksum,
      createdAt: new Date().toISOString(),
      analysisStatus: 'pending',
      segments: [],
    };
    Object.assign(asset, await analyzeMedia(join(this.storageDir, storedName), input.mimeType, this.visionProvider));
    if (asset.type === 'video' && asset.segments.length > 0) {
      await materializeSegments(asset, join(this.storageDir, storedName), this.storageDir);
    }
    this.assets!.push(asset);
    await this.persist();
    return structuredClone(asset);
  }

  async list(filters: AssetListFilters = {}): Promise<Asset[]> {
    await this.load();
    let assets = this.assets!;
    if (filters.type) assets = assets.filter((asset) => asset.type === filters.type);
    if (filters.query) {
      const query = filters.query.toLowerCase();
      assets = assets.filter((asset) => `${asset.filename ?? ''} ${asset.tags.join(' ')}`.toLowerCase().includes(query));
    }
    return structuredClone(assets);
  }

  async update(id: string, patch: { tags?: string[] }): Promise<Asset> {
    await this.load();
    const asset = this.assets!.find((candidate) => candidate.id === id);
    if (!asset) throw new AssetLibraryError('NOT_FOUND', `Unknown asset ${id}`);
    if (patch.tags) asset.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32);
    await this.persist();
    return structuredClone(asset);
  }

  async search(query: string, limit = 5): Promise<AssetMatch[]> {
    await this.load();
    const uploaded: AssetManifestEntry[] = this.assets!.flatMap((asset) => [{
      id: asset.id,
      type: asset.type,
      uri: asset.uri,
      tags: [...asset.tags, ...(asset.segments ?? []).flatMap((segment) => segment.tags)],
      description: `${asset.filename ?? asset.id} ${(asset.segments ?? []).map((segment) => segment.description).join(' ')}`,
      provenance: 'user_upload',
      license: 'user_owned',
    }, ...(asset.segments ?? []).filter((segment) => segment.uri).map((segment) => ({
      id: `${asset.id}:${segment.id}`,
      type: 'video' as const,
      uri: segment.uri!,
      tags: [...asset.tags, ...segment.tags],
      description: `${asset.filename ?? asset.id} ${segment.description}`,
      provenance: 'user_upload',
      license: 'user_owned',
    }))]);
    return searchAssets(query, limit, uploaded);
  }

  private async load(): Promise<void> {
    if (this.assets) return;
    try {
      const raw = await readFile(this.metadataPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.assets = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.assets = [];
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.metadataPath), { recursive: true });
    const temporary = `${this.metadataPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.assets, null, 2));
    await rename(temporary, this.metadataPath);
  }
}

interface MediaAnalysis {
  analysisStatus: 'ready' | 'failed';
  analysisError?: string;
  analysisModel?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  segments: Array<{ id: string; startSec: number; endSec: number; description: string; tags: string[]; confidence?: number }>;
}

async function analyzeMedia(path: string, mimeType: string, visionProvider?: VisionProvider): Promise<MediaAnalysis> {
  if (!mimeType.startsWith('video/')) return { analysisStatus: 'ready', segments: [] };
  try {
    const probe = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(probe.stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.find((candidate) => candidate.codec_type === 'video');
    const durationSec = Number(stream?.duration ?? parsed.format?.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return { analysisStatus: 'ready', segments: [] };
    const cuts = await detectSceneCuts(path);
    const boundaries = [0, ...cuts.filter((cut) => cut > 0.75 && cut < durationSec - 0.25), durationSec]
      .sort((left, right) => left - right)
      .filter((value, index, values) => index === 0 || value - values[index - 1]! >= 0.5);
    let segments: MediaAnalysis['segments'] = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startSec = boundaries[index]!;
      const endSec = boundaries[index + 1]!;
      segments.push({
        id: `segment_${index + 1}`,
        startSec: Number(startSec.toFixed(3)),
        endSec: Number(endSec.toFixed(3)),
        description: `视频片段 ${index + 1}（${formatTime(startSec)}–${formatTime(endSec)}）`,
        tags: [],
      });
    }
    let analysisError: string | undefined;
    if (visionProvider) {
      try {
        segments = await analyzeSemanticVideo(path, durationSec, cuts, visionProvider);
      } catch (error) {
        analysisError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      analysisStatus: 'ready',
      analysisModel: visionProvider?.model,
      analysisError,
      durationSec: Number(durationSec.toFixed(3)),
      width: stream?.width,
      height: stream?.height,
      segments,
    };
  } catch (error) {
    return {
      analysisStatus: 'failed',
      analysisError: error instanceof Error ? error.message : String(error),
      segments: [],
    };
  }
}

async function analyzeSemanticVideo(path: string, durationSec: number, cuts: number[], provider: VisionProvider): Promise<MediaAnalysis['segments']> {
  const workDir = await mkdtemp(join(tmpdir(), 'duplex-vision-'));
  try {
    const windows = analysisWindows(durationSec, cuts, 90);
    const output: MediaAnalysis['segments'] = [];
    for (const [index, window] of windows.entries()) {
      const proxy = join(workDir, `window-${index}.mp4`);
      await cutVideo(path, proxy, window.startSec, window.endSec, true);
      const result = await provider.analyze(await readFile(proxy), window.endSec - window.startSec);
      for (const segment of result) {
        const startSec = window.startSec + segment.startSec;
        const endSec = Math.min(window.startSec + segment.endSec, durationSec);
        if (endSec - startSec < 0.25) continue;
        output.push({
          id: `segment_${output.length + 1}`,
          startSec: Number(startSec.toFixed(3)),
          endSec: Number(endSec.toFixed(3)),
          description: segment.description,
          tags: segment.tags,
          confidence: segment.confidence,
        });
      }
    }
    return output.sort((a, b) => a.startSec - b.startSec);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function materializeSegments(asset: Asset, sourcePath: string, storageDir: string): Promise<void> {
  if (!asset.durationSec) return;
  for (const segment of asset.segments) {
    const filename = `${asset.id}-${segment.id}.mp4`;
    await cutVideo(sourcePath, join(storageDir, filename), segment.startSec, segment.endSec);
    segment.uri = `/media/uploads/${filename}`;
    segment.parentAssetId = asset.id;
    segment.sourceStartSec = segment.startSec;
    segment.sourceEndSec = segment.endSec;
  }
}

async function detectSceneCuts(path: string): Promise<number[]> {
  try {
    const result = await execFileAsync('ffmpeg', [
      '-hide_banner', '-i', path,
      '-vf', "select='gt(scene,0.32)',showinfo",
      '-an', '-f', 'null', '-',
    ], { maxBuffer: 8 * 1024 * 1024 });
    const output = `${result.stdout}\n${result.stderr}`;
    return [...output.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  } catch {
    return [];
  }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}
