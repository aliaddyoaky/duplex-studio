import type { TaskRecord } from '../../shared/schemas.js';
import type { VersionedTaskResult } from './staleGuard.js';

export interface TaskResult extends VersionedTaskResult {
  value?: unknown;
}

export interface TaskContext {
  task: TaskRecord;
  signal: AbortSignal;
  sessionEpoch: number;
}

export type TaskRunner = (context: TaskContext) => Promise<TaskResult>;

export class Scheduler {
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly runner: TaskRunner,
    private readonly getSessionEpoch: () => number,
  ) {}

  async start(task: TaskRecord): Promise<TaskResult> {
    if (this.activeControllers.has(task.id)) {
      throw new Error(`Task ${task.id} is already running`);
    }

    const controller = new AbortController();
    this.activeControllers.set(task.id, controller);
    const sessionEpoch = this.getSessionEpoch();
    try {
      return await this.runner({ task, signal: controller.signal, sessionEpoch });
    } finally {
      if (this.activeControllers.get(task.id) === controller) {
        this.activeControllers.delete(task.id);
      }
    }
  }

  cancel(taskId: string): boolean {
    const controller = this.activeControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll(): number {
    const count = this.activeControllers.size;
    for (const controller of this.activeControllers.values()) controller.abort();
    return count;
  }

  runningTaskIds(): string[] {
    return [...this.activeControllers.keys()];
  }
}
