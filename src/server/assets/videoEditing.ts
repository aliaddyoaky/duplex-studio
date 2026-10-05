import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function cutVideo(path: string, output: string, startSec: number, endSec: number, analysis = false): Promise<void> {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) throw new Error('无效的剪辑时间范围');
  await run('ffmpeg', [
    '-y', '-v', 'error', '-ss', String(startSec), '-i', path, '-t', String(endSec - startSec),
    '-map', '0:v:0', ...(analysis ? ['-an', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=2'] : ['-map', '0:a?', '-c:a', 'aac']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', analysis ? '28' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
}

export function analysisWindows(durationSec: number, boundaries: number[] = [], maxSec = 20): Array<{ startSec: number; endSec: number }> {
  const cuts = [...new Set([0, ...boundaries.filter((n) => n > 0 && n < durationSec), durationSec])].sort((a, b) => a - b);
  const windows = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    for (let start = cuts[i]!; start < cuts[i + 1]! - 0.001; start += maxSec) {
      windows.push({ startSec: start, endSec: Math.min(start + maxSec, cuts[i + 1]!) });
    }
  }
  return windows;
}
