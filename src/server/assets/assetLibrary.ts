import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import type { Asset } from '../../shared/schemas.js';
import { searchAssets, type AssetManifestEntry, type AssetMatch } from '../tools/assetSearch.js';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_MIME = /^(video|image|audio)\//;

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
  private assets: Asset[] | null = null;

  constructor(options: AssetLibraryOptions = {}) {
    this.storageDir = resolve(options.storageDir ?? 'data/uploads');
    this.metadataPath = resolve(options.metadataPath ?? 'data/library.json');
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
    };
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
    const uploaded: AssetManifestEntry[] = this.assets!.map((asset) => ({
      id: asset.id,
      type: asset.type,
      uri: asset.uri,
      tags: asset.tags,
      description: asset.filename ?? asset.id,
      provenance: 'user_upload',
      license: 'user_owned',
    }));
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
