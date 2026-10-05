import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AudioArtifact } from '../../shared/schemas.js';

const execFileAsync = promisify(execFile);

export interface AudioGenerationBase {
  durationSec: number;
  stateVersion: number;
  sessionEpoch: number;
}

export interface VoiceoverInput extends AudioGenerationBase {
  text: string;
}

export interface BgmInput extends AudioGenerationBase {
  style: string;
  intensity: string;
}

export interface SfxInput extends AudioGenerationBase {
  effects: Array<{ atSec: number; description: string }>;
}

export interface AudioProvider {
  generateVoiceover(input: VoiceoverInput, signal?: AbortSignal): Promise<AudioArtifact>;
  selectOrGenerateBgm(input: BgmInput, signal?: AbortSignal): Promise<AudioArtifact>;
  prepareSfx(input: SfxInput, signal?: AbortSignal): Promise<AudioArtifact[]>;
}

export class LocalAudioProvider implements AudioProvider {
  private readonly outputDir: string;

  constructor(options: { outputDir?: string } = {}) {
    this.outputDir = resolve(options.outputDir ?? 'data/artifacts');
  }

  async generateVoiceover(input: VoiceoverInput, signal?: AbortSignal): Promise<AudioArtifact> {
    if (!input.text.trim()) throw new Error('Voiceover text must not be empty');
    await mkdir(this.outputDir, { recursive: true });
    const uri = resolve(this.outputDir, `voiceover_v${input.stateVersion}.wav`);
    const temporaryDir = await mkdtemp(join(tmpdir(), 'duplex-voiceover-'));
    const source = join(temporaryDir, 'voiceover.aiff');
    try {
      await execFileAsync('say', ['-v', 'Tingting', '-o', source, input.text], { signal, maxBuffer: 8 * 1024 * 1024 });
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', source,
        '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-y', uri,
      ], { signal, maxBuffer: 8 * 1024 * 1024 });
    } finally {
      await rm(temporaryDir, { recursive: true, force: true });
    }
    return this.artifact(`voiceover_v${input.stateVersion}`, uri, input);
  }

  async selectOrGenerateBgm(input: BgmInput, signal?: AbortSignal): Promise<AudioArtifact> {
    if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) throw new Error('BGM duration must be positive');
    await mkdir(this.outputDir, { recursive: true });
    const uri = resolve(this.outputDir, `bgm_v${input.stateVersion}.wav`);
    const duration = Math.max(0.1, input.durationSec);
    const fadeOut = Math.max(0.1, duration - 1);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=261.63:duration=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=329.63:duration=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=392:duration=${duration}`,
      '-filter_complex',
      `[0:a]volume=0.08[a0];[1:a]volume=0.06[a1];[2:a]volume=0.05[a2];` +
        `[a0][a1][a2]amix=inputs=3:duration=longest,lowpass=f=1800,` +
        `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1[a]`,
      '-map', '[a]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-y', uri,
    ], { signal, maxBuffer: 8 * 1024 * 1024 });
    return this.artifact(`bgm_v${input.stateVersion}`, uri, input);
  }

  async prepareSfx(input: SfxInput, signal?: AbortSignal): Promise<AudioArtifact[]> {
    const outputs: AudioArtifact[] = [];
    for (const [index, effect] of input.effects.entries()) {
      outputs.push(await this.generateTone(`sfx_${index + 1}_v${input.stateVersion}`, 660 + index * 110, 0.35, input, signal));
    }
    return outputs;
  }

  private async generateTone(
    id: string,
    frequency: number,
    durationSec: number,
    input: AudioGenerationBase,
    signal?: AbortSignal,
  ): Promise<AudioArtifact> {
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('Audio duration must be positive');
    await mkdir(this.outputDir, { recursive: true });
    const uri = resolve(this.outputDir, `${id}.wav`);
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequency}:duration=${Math.max(0.1, durationSec)}`,
        '-ac',
        '2',
        '-ar',
        '48000',
        '-c:a',
        'pcm_s16le',
        '-y',
        uri,
      ],
      { signal, maxBuffer: 8 * 1024 * 1024 },
    );
    return {
      ...this.artifact(id, uri, input),
    };
  }

  private artifact(id: string, uri: string, input: AudioGenerationBase): AudioArtifact {
    return { id, type: 'audio', uri, source: 'live', stateVersion: input.stateVersion, sessionEpoch: input.sessionEpoch };
  }
}
