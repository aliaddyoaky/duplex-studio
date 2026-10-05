import type { VideoArtifact } from '../providers/videoProvider.js';

export class ReplayCatalog {
  constructor(private readonly videos: Record<string, string | VideoArtifact>) {}

  video(sceneId: string, stateVersion: number, sessionEpoch: number): VideoArtifact {
    const recorded = this.videos[sceneId];
    if (!recorded) throw new Error(`Replay has no recorded video for ${sceneId}`);
    if (typeof recorded === 'string') {
      return {
        id: `replay_${sceneId}`,
        type: 'video',
        uri: recorded,
        source: 'fallback',
        stateVersion,
        sessionEpoch,
      };
    }
    return { ...recorded, source: 'fallback', stateVersion, sessionEpoch };
  }
}
