import type { Artifact } from '../../shared/schemas.js';
import type { ResultDisposition } from './staleGuard.js';

export class ArtifactRegistry {
  private readonly activeArtifacts = new Map<string, Artifact>();
  private readonly rejectedArtifacts: Array<{ artifact: Artifact; disposition: ResultDisposition }> = [];

  register(artifact: Artifact, disposition: ResultDisposition): boolean {
    if (disposition !== 'ACCEPT') {
      this.rejectedArtifacts.push({ artifact, disposition });
      return false;
    }
    this.activeArtifacts.set(artifact.id, artifact);
    return true;
  }

  active(): Artifact[] {
    return [...this.activeArtifacts.values()];
  }

  rejected(): Array<{ artifact: Artifact; disposition: ResultDisposition }> {
    return [...this.rejectedArtifacts];
  }

  clear(): void {
    this.activeArtifacts.clear();
    this.rejectedArtifacts.length = 0;
  }
}
