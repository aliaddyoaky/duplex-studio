import type { ImageArtifact, ImageProvider } from '../providers/imageProvider.js';
import type { CreativePlan } from './creativeTools.js';

export interface ImageReferenceContext {
  stateVersion: number;
  sessionEpoch: number;
}

export async function generateImageReferences(
  plan: CreativePlan,
  provider: ImageProvider,
  context: ImageReferenceContext,
): Promise<ImageArtifact[]> {
  const requested = plan.scenes.filter((scene) => scene.needsImageReference);
  return Promise.all(
    requested.map((scene) =>
      provider.generateReference({
        scene,
        stateVersion: context.stateVersion,
        sessionEpoch: context.sessionEpoch,
      }),
    ),
  );
}
