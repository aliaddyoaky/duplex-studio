import { execFile } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { assertFfmpegAvailable, renderPreview } from '../src/server/tools/renderPreview.js';
import type { VideoArtifact } from '../src/server/providers/videoProvider.js';

const execFileAsync = promisify(execFile);

describe('renderPreview', () => {
  it('composes mixed clips into a real 9:16 mp4 lasting 10–15 seconds', async () => {
    await assertFfmpegAvailable();
    const dir = await mkdtemp(join(tmpdir(), 'duplex-preview-'));
    const landscape = join(dir, 'landscape.mp4');
    const portrait = join(dir, 'portrait.mp4');
    await makeColorClip(landscape, '0xF5A623', '320x180', 3.2);
    await makeColorClip(portrait, '0x4A90E2', '180x320', 3.2);

    const artifact = await renderPreview({
      clips: [
        clip(landscape, 'existing', 1, 1, 3, '校园真实感'),
        clip(portrait, 'live', 1, 1, 3, '低糖气泡咖啡'),
        clip(landscape, 'existing', 1, 1, 3, '轻松，不像广告'),
        clip(portrait, 'live', 1, 1, 3, '今天就喝这个'),
      ],
      outputId: 'preview_v1',
      outputDir: dir,
      stateVersion: 1,
      sessionEpoch: 1,
    });

    expect((await stat(artifact.uri)).size).toBeGreaterThan(1_000);
    expect(artifact).toMatchObject({
      id: 'preview_v1',
      type: 'video',
      source: 'live',
      stateVersion: 1,
      sessionEpoch: 1,
    });
    const probe = await probeVideo(artifact.uri);
    expect(probe.streams[0]).toMatchObject({ width: 720, height: 1280, codec_type: 'video' });
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(10);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(15);
  }, 20_000);

  it('pads a short source clip so requested scene durations still produce a 10–15 second preview', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'duplex-short-preview-'));
    const short = join(dir, 'short.mp4');
    await makeColorClip(short, '0x50E3C2', '180x320', 1);

    const artifact = await renderPreview({
      clips: [
        clip(short, 'existing', 3, 1, 3, '一'),
        clip(short, 'existing', 3, 1, 3, '二'),
        clip(short, 'existing', 3, 1, 3, '三'),
        clip(short, 'existing', 3, 1, 3, '四'),
      ],
      outputId: 'preview_short_sources',
      outputDir: dir,
      stateVersion: 3,
      sessionEpoch: 1,
    });

    const probe = await probeVideo(artifact.uri);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(11.9);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(12.1);
  }, 20_000);

  it('mixes independent audio inputs into exactly one final audio stream', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'duplex-audio-preview-'));
    const clipPath = join(dir, 'silent.mp4');
    await makeColorClip(clipPath, '0x50E3C2', '180x320', 2);
    const provider = new (await import('../src/server/providers/audioProvider.js')).LocalAudioProvider({ outputDir: dir });
    const voiceover = await provider.generateVoiceover({ text: '旁白', durationSec: 2, stateVersion: 1, sessionEpoch: 1 });
    const bgm = await provider.selectOrGenerateBgm({ style: '轻快', intensity: '低', durationSec: 2, stateVersion: 1, sessionEpoch: 1 });
    const artifact = await renderPreview({
      clips: [clip(clipPath, 'existing', 1, 1, 2, '统一音轨')],
      audioMix: { voiceover, bgm, ducking: { voiceoverDb: -3, bgmDb: -16 } },
      outputId: 'preview_audio_mix',
      outputDir: dir,
      stateVersion: 1,
      sessionEpoch: 1,
    });
    const probe = await probeVideo(artifact.uri);
    expect(probe.streams.filter((stream) => stream.codec_type === 'audio')).toHaveLength(1);
  }, 20_000);
});

function clip(
  uri: string,
  source: VideoArtifact['source'],
  stateVersion: number,
  sessionEpoch: number,
  durationSec: number,
  caption: string,
) {
  return {
    artifact: {
      id: `clip_${caption}`,
      type: 'video' as const,
      uri,
      source,
      stateVersion,
      sessionEpoch,
    },
    durationSec,
    caption,
  };
}

async function makeColorClip(path: string, color: string, size: string, duration: number) {
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${size}:r=24:d=${duration}`,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    path,
  ]);
}

async function probeVideo(path: string): Promise<{
  streams: Array<{ width: number; height: number; codec_type: string }>;
  format: { duration: string };
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height:format=duration',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(stdout);
}
