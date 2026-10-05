import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AudioArtifact } from '../../shared/schemas.js';
import type { VideoArtifact } from '../providers/videoProvider.js';

const execFileAsync = promisify(execFile);

export interface RenderClip {
  artifact: VideoArtifact;
  durationSec: number;
  caption?: string;
}

export interface RenderAudioMix {
  voiceover?: AudioArtifact;
  bgm?: AudioArtifact;
  sfx?: Array<{ artifact: AudioArtifact; atSec?: number; volumeDb?: number }>;
  ducking?: { voiceoverDb: number; bgmDb: number };
}

export interface RenderInput {
  clips: RenderClip[];
  outputId: string;
  stateVersion: number;
  sessionEpoch: number;
  outputDir?: string;
  audioMix?: RenderAudioMix;
}

export async function assertFfmpegAvailable(): Promise<void> {
  try {
    await Promise.all([
      execFileAsync('ffmpeg', ['-version']),
      execFileAsync('ffprobe', ['-version']),
    ]);
  } catch (error) {
    throw new Error('FFmpeg and ffprobe are required to render previews', { cause: error });
  }
}

export async function renderPreview(
  input: RenderInput,
  signal?: AbortSignal,
): Promise<VideoArtifact> {
  if (input.clips.length === 0) throw new Error('Cannot render a preview without clips');
  for (const clip of input.clips) {
    if (!Number.isFinite(clip.durationSec) || clip.durationSec <= 0) {
      throw new Error(`Invalid scene duration for ${clip.artifact.id}`);
    }
  }

  const outputDir = resolve(input.outputDir ?? 'data/artifacts');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${input.outputId}.mp4`);
  const captionDir = await mkdtemp(join(tmpdir(), 'duplex-captions-'));

  try {
    const captionsAvailable = input.clips.some((clip) => clip.caption?.trim())
      ? await hasFfmpegFilter('drawtext')
      : false;
    const args = ['-hide_banner', '-loglevel', 'error'];
    for (const clip of input.clips) args.push('-i', resolve(clip.artifact.uri));
    const audioTracks: Array<{ artifact: AudioArtifact; atSec: number; volumeDb: number }> = [];
    if (input.audioMix?.voiceover) {
      audioTracks.push({
        artifact: input.audioMix.voiceover,
        atSec: 0,
        volumeDb: input.audioMix.ducking?.voiceoverDb ?? 0,
      });
    }
    if (input.audioMix?.bgm) {
      audioTracks.push({
        artifact: input.audioMix.bgm,
        atSec: 0,
        volumeDb: input.audioMix.ducking?.bgmDb ?? 0,
      });
    }
    for (const track of input.audioMix?.sfx ?? []) {
      audioTracks.push({ artifact: track.artifact, atSec: track.atSec ?? 0, volumeDb: track.volumeDb ?? -8 });
    }
    for (const track of audioTracks) args.push('-i', resolve(track.artifact.uri));

    const filters: string[] = [];
    const outputLabels: string[] = [];
    for (const [index, clip] of input.clips.entries()) {
      const label = `v${index}`;
      outputLabels.push(`[${label}]`);
      const chain = [
        `[${index}:v]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${clip.durationSec},trim=duration=${clip.durationSec}`,
        'scale=720:1280:force_original_aspect_ratio=increase',
        'crop=720:1280',
        'setsar=1',
        'fps=30',
      ];
      if (captionsAvailable && clip.caption?.trim()) {
        const captionPath = join(captionDir, `caption-${index}.txt`);
        await writeFile(captionPath, clip.caption.trim(), 'utf8');
        chain.push(
          `drawtext=textfile='${escapeFilterValue(captionPath)}':fontcolor=white:fontsize=42:` +
            'box=1:boxcolor=black@0.48:boxborderw=18:x=(w-text_w)/2:y=h-text_h-120',
        );
      }
      chain.push(`format=yuv420p[${label}]`);
      filters.push(chain.join(','));
    }
    filters.push(`${outputLabels.join('')}concat=n=${input.clips.length}:v=1:a=0[vout]`);

    const totalDuration = input.clips.reduce((sum, clip) => sum + clip.durationSec, 0);
    if (audioTracks.length > 0) {
      const audioLabels: string[] = [];
      const firstAudioIndex = input.clips.length;
      for (const [index, track] of audioTracks.entries()) {
        const label = `a${index}`;
        audioLabels.push(`[${label}]`);
        const delay = track.atSec > 0 ? `,adelay=${Math.round(track.atSec * 1000)}:all=1` : '';
        filters.push(
          `[${firstAudioIndex + index}:a]aresample=48000,volume=${track.volumeDb}dB${delay},` +
            `apad,atrim=duration=${totalDuration}[${label}]`,
        );
      }
      filters.push(`${audioLabels.join('')}amix=inputs=${audioTracks.length}:duration=longest:dropout_transition=0,aresample=48000,atrim=duration=${totalDuration}[aout]`);
    }

    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vout]',
      ...(audioTracks.length > 0 ? ['-map', '[aout]'] : ['-an']),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      ...(audioTracks.length > 0 ? ['-c:a', 'aac', '-b:a', '192k'] : []),
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    );

    await execFileAsync('ffmpeg', args, { signal, maxBuffer: 8 * 1024 * 1024 });
  } finally {
    await rm(captionDir, { recursive: true, force: true });
  }

  return {
    id: input.outputId,
    type: 'video',
    uri: outputPath,
    source: 'live',
    stateVersion: input.stateVersion,
    sessionEpoch: input.sessionEpoch,
  };
}

async function hasFfmpegFilter(filterName: string): Promise<boolean> {
  try {
    const result = await execFileAsync('ffmpeg', ['-hide_banner', '-filters']);
    return `${result.stdout}\n${result.stderr}`.split(/\r?\n/).some((line) => {
      const columns = line.trim().split(/\s+/);
      return columns[1] === filterName;
    });
  } catch {
    return false;
  }
}

function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}
