import type {
  VideoArtifact,
  VideoGenerationInput,
  VideoProvider,
} from '../providers/videoProvider.js';

export function generateVideo(
  provider: VideoProvider,
  input: VideoGenerationInput,
  signal?: AbortSignal,
): Promise<VideoArtifact> {
  return provider.generate(input, signal);
}
