import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface HistorySnapshot {
  projectId: string;
  version: number;
  phase: string;
  savedAt: string;
  state: unknown;
  tasks: unknown[];
  artifacts: unknown[];
  events?: unknown[];
}

export interface HistorySummary {
  version: number;
  phase: string;
  savedAt: string;
  taskCount: number;
  artifactCount: number;
}

function safeProjectId(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid project id');
  return projectId;
}

export class HistoryStore {
  private readonly rootDir: string;

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir = resolve(options.rootDir ?? 'data/projects');
  }

  async saveVersion(snapshot: HistorySnapshot): Promise<void> {
    const projectId = safeProjectId(snapshot.projectId);
    if (!Number.isInteger(snapshot.version) || snapshot.version < 0) throw new Error('Invalid history version');
    const directory = join(this.rootDir, projectId, 'history');
    await mkdir(directory, { recursive: true });
    const target = join(directory, `v${snapshot.version}-${snapshot.phase.toLowerCase()}.json`);
    const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(structuredClone({ ...snapshot, projectId }), null, 2));
    await rename(temporary, target);
  }

  async list(projectId: string): Promise<HistorySummary[]> {
    const snapshots = await this.readAll(projectId);
    return snapshots
      .sort((left, right) => right.version - left.version)
      .map((snapshot) => ({
        version: snapshot.version,
        phase: snapshot.phase,
        savedAt: snapshot.savedAt,
        taskCount: snapshot.tasks.length,
        artifactCount: snapshot.artifacts.length,
      }));
  }

  async get(projectId: string, version: number): Promise<HistorySnapshot | null> {
    safeProjectId(projectId);
    try {
      const directory = join(this.rootDir, projectId, 'history');
      const names = (await readdir(directory)).filter((name) => new RegExp(`^v${version}(?:-|\\.)`).test(name));
      const snapshots = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')) as HistorySnapshot));
      snapshots.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      return snapshots[0] ? structuredClone(snapshots[0]) : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readAll(projectId: string): Promise<HistorySnapshot[]> {
    const safeId = safeProjectId(projectId);
    const snapshots: HistorySnapshot[] = [];
    let names: string[];
    try {
      names = await readdir(join(this.rootDir, safeId, 'history'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshots;
      throw error;
    }
    for (const name of names) {
      const match = /^v(\d+)(?:-[^.]+)?\.json$/.exec(name);
      if (!match) continue;
      try {
        snapshots.push(JSON.parse(await readFile(join(this.rootDir, safeId, 'history', name), 'utf8')) as HistorySnapshot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return snapshots;
  }
}
