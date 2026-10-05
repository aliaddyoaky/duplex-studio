export interface VersionedTaskResult {
  taskId: string;
  stateVersion: number;
  sessionEpoch: number;
}

export type ResultDisposition = 'ACCEPT' | 'STALE_VERSION' | 'STALE_EPOCH';

export function acceptResult(
  result: VersionedTaskResult,
  currentVersion: number,
  currentEpoch: number,
): ResultDisposition {
  if (result.sessionEpoch !== currentEpoch) return 'STALE_EPOCH';
  if (result.stateVersion !== currentVersion) return 'STALE_VERSION';
  return 'ACCEPT';
}
