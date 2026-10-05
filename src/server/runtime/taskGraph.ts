import type { TaskRecord } from '../../shared/schemas.js';
import type { InvalidationResult, TaskAction } from './invalidation.js';

export interface TaskDecision {
  taskId: string;
  action: TaskAction;
}

export interface TaskGraph {
  version: number;
  tasks: TaskRecord[];
  decisions: TaskDecision[];
}

function replacementId(id: string, version: number): string {
  return `${id.replace(/@v\d+$/, '')}@v${version}`;
}

export function replanGraph(
  previousGraph: TaskGraph,
  newVersion: number,
  invalidation: InvalidationResult,
): TaskGraph {
  const tasks: TaskRecord[] = [];
  const decisions: TaskDecision[] = [];

  for (const original of previousGraph.tasks) {
    const action = invalidation.actionByTaskId[original.id] ?? 'REUSE';
    decisions.push({ taskId: original.id, action });

    if (action === 'CANCEL') {
      tasks.push({ ...original, status: 'cancelled' });
      const replacement: TaskRecord = {
        ...original,
        id: replacementId(original.id, newVersion),
        stateVersion: newVersion,
        status: 'pending',
        startedAt: undefined,
        finishedAt: undefined,
        artifactIds: undefined,
      };
      tasks.push(replacement);
      decisions.push({ taskId: replacement.id, action: 'CREATE' });
      continue;
    }

    tasks.push({ ...original, stateVersion: newVersion });
  }

  return { version: newVersion, tasks, decisions };
}
