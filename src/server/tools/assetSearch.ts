import manifestJson from '../../../demo/assets/manifest.json';
import type { SceneSource } from '../../shared/schemas.js';
import { CreativePlanSchema, type CreativePlan } from './creativeTools.js';

export interface AssetManifestEntry {
  id: string;
  type: 'image' | 'video' | 'audio';
  uri: string;
  tags: string[];
  description: string;
  provenance: string;
  license: string;
}

export interface AssetMatch extends AssetManifestEntry {
  score: number;
}

const defaultManifest = manifestJson as AssetManifestEntry[];

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

export function searchAssetManifest(
  query: string,
  manifest: AssetManifestEntry[],
  limit = 5,
): AssetMatch[] {
  const queryTokens = tokens(query);
  return manifest
    .map((asset) => {
      const tags = new Set(asset.tags.map((tag) => tag.toLowerCase()));
      const haystack = `${asset.id} ${asset.description}`.toLowerCase();
      const score = queryTokens.reduce(
        (total, token) => total + (tags.has(token) ? 2 : haystack.includes(token) ? 1 : 0),
        0,
      );
      return { ...asset, score };
    })
    .filter((asset) => asset.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.provenance === 'user_upload') - Number(left.provenance === 'user_upload') ||
      left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, limit));
}

export function searchAssets(
  query: string,
  limit = 5,
  additionalManifest: AssetManifestEntry[] = [],
): AssetMatch[] {
  return searchAssetManifest(query, [...defaultManifest, ...additionalManifest], limit);
}

export function routeSceneSource(
  plan: CreativePlan,
  sceneId: string,
  source: SceneSource,
): CreativePlan {
  const next = structuredClone(plan);
  const scene = next.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  scene.source = source;
  if (source === 'existing_asset') scene.generationPrompt = undefined;
  return CreativePlanSchema.parse(next);
}
