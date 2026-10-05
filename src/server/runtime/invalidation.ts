import type { TaskRecord } from '../../shared/schemas.js';

export type TaskAction = 'KEEP' | 'REUSE' | 'CANCEL' | 'CREATE';

export interface InvalidationResult {
  actionByTaskId: Record<string, Exclude<TaskAction, 'CREATE'>>;
}

const allCreative = ['strategy', 'script', 'asset_search', 'storyboard', 'generated_scene', 'render'];

const fieldDependencies: Array<[RegExp, string[]]> = [
  [/^brief\.product$/, ['product_analysis', ...allCreative]],
  [/^brief\.audience$/, allCreative],
  [/^creative\.sellingPoint$/, ['script', 'storyboard', 'generated_scene', 'render']],
  [/^creative\.(style|tone)$/, ['asset_search', 'storyboard', 'generated_scene', 'render']],
  [/^brief\.platform$/, ['script', 'aspect_ratio', 'storyboard', 'render']],
  [/^brief\.duration$/, ['script', 'storyboard', 'generated_scene', 'render']],
];

function taskFamily(task: TaskRecord): string {
  return task.type.split(':', 1)[0];
}

function affectedFamilies(field: string): Set<string> {
  const sceneMatch = field.match(/^scenes\.(scene_[^.]+)\.source$/);
  if (sceneMatch) return new Set([`generated_scene:${sceneMatch[1]}`, 'render']);

  for (const [pattern, families] of fieldDependencies) {
    if (pattern.test(field)) return new Set(families);
  }

  return new Set(allCreative);
}

function isAffected(task: TaskRecord, families: Set<string>): boolean {
  if (families.has(task.type)) return true;
  return families.has(taskFamily(task));
}

export function classifyTasks(tasks: TaskRecord[], changedFields: string[]): InvalidationResult {
  const actionByTaskId: InvalidationResult['actionByTaskId'] = {};
  const affectedSets = changedFields.map(affectedFamilies);

  for (const task of tasks) {
    const affected = affectedSets.some((families) => isAffected(task, families));
    if (affected) {
      actionByTaskId[task.id] = 'CANCEL';
    } else {
      actionByTaskId[task.id] = task.status === 'completed' ? 'REUSE' : 'KEEP';
    }
  }

  return { actionByTaskId };
}
