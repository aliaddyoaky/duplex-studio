export interface AudioPlaybackLike {
  enqueueBase64(base64Pcm16: string): void;
  clear(): void;
  close(): void;
}

function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const output = new Float32Array(byteLength / 2);
  for (let index = 0; index < output.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    output[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return output;
}

export class BrowserAudioPlayback implements AudioPlaybackLike {
  private context?: AudioContext;
  private nextStartAt = 0;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(private readonly sampleRate = 24_000) {}

  enqueueBase64(base64Pcm16: string): void {
    const context = this.context ?? new AudioContext();
    this.context = context;
    void context.resume();
    const samples = pcm16Base64ToFloat32(base64Pcm16);
    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startsAt = Math.max(context.currentTime + 0.01, this.nextStartAt);
    this.nextStartAt = startsAt + buffer.duration;
    this.active.add(source);
    source.onended = () => this.active.delete(source);
    source.start(startsAt);
  }

  clear(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // A source that already ended can race the interruption signal.
      }
    }
    this.active.clear();
    this.nextStartAt = this.context?.currentTime ?? 0;
  }

  close(): void {
    this.clear();
    void this.context?.close();
    this.context = undefined;
  }
}
