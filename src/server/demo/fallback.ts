import type {
  VideoArtifact,
  VideoGenerationInput,
  VideoProvider,
} from '../providers/videoProvider.js';

export type DemoMode = 'LIVE' | 'HYBRID' | 'REPLAY';

export async function generateVideoWithFallback(
  mode: DemoMode,
  provider: VideoProvider,
  input: VideoGenerationInput,
  fallback: VideoArtifact,
  signal?: AbortSignal,
): Promise<VideoArtifact> {
  if (mode === 'REPLAY') {
    return {
      ...fallback,
      source: 'fallback',
      stateVersion: input.stateVersion,
      sessionEpoch: input.sessionEpoch,
    };
  }

  try {
    return await provider.generate(input, signal);
  } catch (error) {
    if (mode === 'LIVE') throw error;
    return {
      ...fallback,
      source: 'fallback',
      stateVersion: input.stateVersion,
      sessionEpoch: input.sessionEpoch,
    };
  }
}
