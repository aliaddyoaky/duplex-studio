import { describe, expect, it, vi } from 'vitest';

import { runGoldenReplay, type GoldenReplayApi } from '../src/client/replayGoldenPath.js';

describe('Golden Replay interview fallback', () => {
  it('replays all three turns in order and waits for each preview boundary', async () => {
    const calls: string[] = [];
    const api: GoldenReplayApi = {
      setMode: vi.fn(async () => { calls.push('mode'); }),
      reset: vi.fn(async () => { calls.push('reset'); }),
      create: vi.fn(async () => { calls.push('turn1'); }),
      confirm: vi.fn(async () => { calls.push('confirm'); }),
      patch: vi.fn(async (patch) => { calls.push(patch.patchId); }),
      waitForPreview: vi.fn(async (version) => { calls.push(`preview${version}`); }),
    };

    await runGoldenReplay(api);

    expect(calls).toEqual([
      'mode', 'reset', 'turn1', 'confirm', 'preview1', 'patch_02', 'confirm', 'preview2', 'patch_03', 'confirm', 'preview3',
    ]);
  });
});
