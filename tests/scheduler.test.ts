import { describe, expect, it } from 'vitest';

import { ArtifactRegistry } from '../src/server/runtime/artifactRegistry.js';
import { Scheduler, type TaskRunner } from '../src/server/runtime/scheduler.js';
import { acceptResult } from '../src/server/runtime/staleGuard.js';
import type { TaskRecord } from '../src/shared/schemas.js';

function task(id: string, type = id, version = 1): TaskRecord {
  return {
    id,
    type,
    stateVersion: version,
    dependencies: [],
    affectedBy: [],
    status: 'pending',
  };
}

describe('parallel scheduler and stale guard', () => {
  it('lets independent tasks run concurrently', async () => {
    const releases = new Map<string, () => void>();
    const runner: TaskRunner = ({ task: runningTask, sessionEpoch }) =>
      new Promise((resolve) => {
        releases.set(runningTask.id, () =>
          resolve({
            taskId: runningTask.id,
            stateVersion: runningTask.stateVersion,
            sessionEpoch,
          }),
        );
      });
    const scheduler = new Scheduler(runner, () => 7);

    const first = scheduler.start(task('first'));
    const second = scheduler.start(task('second'));
    await Promise.resolve();

    expect(releases.size).toBe(2);
    releases.get('second')!();
    await expect(second).resolves.toMatchObject({ taskId: 'second', sessionEpoch: 7 });
    releases.get('first')!();
    await expect(first).resolves.toMatchObject({ taskId: 'first', sessionEpoch: 7 });
  });

  it('aborts a controllable running task', async () => {
    const runner: TaskRunner = ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const scheduler = new Scheduler(runner, () => 1);
    const running = scheduler.start(task('video'));

    expect(scheduler.cancel('video')).toBe(true);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an uncancellable v1 result after state v2 becomes current', () => {
    const result = { taskId: 'storyboard', stateVersion: 1, sessionEpoch: 3 };
    expect(acceptResult(result, 2, 3)).toBe('STALE_VERSION');

    const registry = new ArtifactRegistry();
    const registered = registry.register(
      {
        id: 'storyboard_v1',
        type: 'storyboard',
        uri: 'memory://storyboard-v1',
        source: 'live',
        stateVersion: 1,
        sessionEpoch: 3,
      },
      acceptResult(result, 2, 3),
    );
    expect(registered).toBe(false);
    expect(registry.active()).toEqual([]);
  });

  it('accepts only the newest result across overlapping v2 and v3 patches', () => {
    expect(acceptResult({ taskId: 'script', stateVersion: 1, sessionEpoch: 4 }, 3, 4)).toBe(
      'STALE_VERSION',
    );
    expect(acceptResult({ taskId: 'script', stateVersion: 2, sessionEpoch: 4 }, 3, 4)).toBe(
      'STALE_VERSION',
    );
    expect(acceptResult({ taskId: 'script', stateVersion: 3, sessionEpoch: 4 }, 3, 4)).toBe(
      'ACCEPT',
    );
  });

  it('rejects results from a previous session epoch even when the version matches', () => {
    expect(acceptResult({ taskId: 'render', stateVersion: 1, sessionEpoch: 4 }, 1, 5)).toBe(
      'STALE_EPOCH',
    );
  });
});
