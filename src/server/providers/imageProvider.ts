import type { Artifact } from '../../shared/schemas.js';
import type { PlannedScene } from '../tools/creativeTools.js';

export interface ImageReferenceInput {
  scene: PlannedScene;
  stateVersion: number;
  sessionEpoch: number;
}

export type ImageArtifact = Artifact & { type: 'image' };

export interface ImageProvider {
  generateReference(input: ImageReferenceInput): Promise<ImageArtifact>;
}
