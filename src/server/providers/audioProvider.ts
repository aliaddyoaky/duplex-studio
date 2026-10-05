import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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
    return this.generateTone(`voiceover_v${input.stateVersion}`, 440, input.durationSec, input, signal);
  }

  async selectOrGenerateBgm(input: BgmInput, signal?: AbortSignal): Promise<AudioArtifact> {
    return this.generateTone(`bgm_v${input.stateVersion}`, 220, input.durationSec, input, signal);
  }

  async prepareSfx(input: SfxInput, signal?: AbortSignal): Promise<AudioArtifact[]> {
    const outputs: AudioArtifact[] = [];
    for (const [index, effect] of input.effects.entries()) {
      outputs.push(await this.generateTone(`sfx_${index + 1}_v${input.stateVersion}`, 880, 0.35, input, signal));
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
      id,
      type: 'audio',
      uri,
      source: 'live',
      stateVersion: input.stateVersion,
      sessionEpoch: input.sessionEpoch,
    };
  }
}
