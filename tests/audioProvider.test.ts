import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalAudioProvider } from '../src/server/providers/audioProvider.js';

describe('LocalAudioProvider', () => {
  it('creates one project-level voiceover, bgm, and sfx artifact set', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'duplex-audio-'));
    const provider = new LocalAudioProvider({ outputDir });
    const base = { durationSec: 4, stateVersion: 2, sessionEpoch: 1 };
    const voiceover = await provider.generateVoiceover({ ...base, text: '一杯清爽的低糖咖啡' });
    const bgm = await provider.selectOrGenerateBgm({ ...base, style: '轻快电子', intensity: '低' });
    const sfx = await provider.prepareSfx({
      ...base,
      effects: [{ atSec: 1.5, description: '清脆提示音' }],
    });

    expect(voiceover.type).toBe('audio');
    expect(bgm.type).toBe('audio');
    expect(sfx).toHaveLength(1);
    await expect(stat(voiceover.uri)).resolves.toBeTruthy();
    await expect(stat(bgm.uri)).resolves.toBeTruthy();
    await expect(stat(sfx[0]!.uri)).resolves.toBeTruthy();
  }, 20_000);
});
