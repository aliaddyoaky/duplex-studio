import { describe, expect, it } from 'vitest';

import { classifyTasks } from '../src/server/runtime/invalidation.js';
import { replanGraph, type TaskGraph } from '../src/server/runtime/taskGraph.js';
import type { TaskRecord } from '../src/shared/schemas.js';

function task(id: string, type: string, status: TaskRecord['status'] = 'completed'): TaskRecord {
  return {
    id,
    type,
    stateVersion: 1,
    dependencies: [],
    affectedBy: [],
    status,
  };
}

const baseTasks = [
  task('product', 'product_analysis'),
  task('script', 'script'),
  task('storyboard', 'storyboard'),
  task('scene_1', 'generated_scene:scene_1'),
  task('scene_2', 'generated_scene:scene_2'),
  task('scene_3', 'generated_scene:scene_3'),
  task('scene_4', 'generated_scene:scene_4'),
  task('render', 'render'),
];

describe('dependency-aware invalidation', () => {
  it('reuses product analysis but replans creative work when the selling point changes', () => {
    const result = classifyTasks(baseTasks, ['creative.sellingPoint']);
    expect(result.actionByTaskId).toMatchObject({
      product: 'REUSE',
      script: 'CANCEL',
      storyboard: 'CANCEL',
      scene_1: 'CANCEL',
      scene_2: 'CANCEL',
      scene_3: 'CANCEL',
      scene_4: 'CANCEL',
      render: 'CANCEL',
    });
  });

  it('replans only scene 3 and render for a scene 3 source change', () => {
    const result = classifyTasks(baseTasks, ['scenes.scene_3.source']);
    expect(result.actionByTaskId).toMatchObject({
      product: 'REUSE',
      script: 'REUSE',
      storyboard: 'REUSE',
      scene_1: 'REUSE',
      scene_2: 'REUSE',
      scene_3: 'CANCEL',
      scene_4: 'REUSE',
      render: 'CANCEL',
    });
  });

  it('conservatively invalidates downstream creative work for an unknown field', () => {
    const result = classifyTasks(baseTasks, ['creative.experimentalDirection']);
    expect(result.actionByTaskId.product).toBe('REUSE');
    expect(result.actionByTaskId.script).toBe('CANCEL');
    expect(result.actionByTaskId.storyboard).toBe('CANCEL');
    expect(result.actionByTaskId.render).toBe('CANCEL');
  });

  it('promotes reusable tasks and creates v2 replacements for cancelled tasks', () => {
    const graph: TaskGraph = { version: 1, tasks: baseTasks, decisions: [] };
    const invalidation = classifyTasks(baseTasks, ['scenes.scene_3.source']);
    const next = replanGraph(graph, 2, invalidation);

    expect(next.version).toBe(2);
    expect(next.tasks.find((item) => item.id === 'scene_2')?.stateVersion).toBe(2);
    expect(next.tasks.find((item) => item.id === 'scene_3')?.status).toBe('cancelled');
    expect(next.tasks).toContainEqual(
      expect.objectContaining({
        id: 'scene_3@v2',
        type: 'generated_scene:scene_3',
        stateVersion: 2,
        status: 'pending',
      }),
    );
    expect(next.tasks).toContainEqual(
      expect.objectContaining({ id: 'render@v2', stateVersion: 2, status: 'pending' }),
    );
  });
});
