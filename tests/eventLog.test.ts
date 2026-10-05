import { describe, expect, it } from 'vitest';

import { computeMetrics, EventLog } from '../src/server/runtime/eventLog.js';
import { buildSseBootstrap } from '../src/server/routes/events.js';

describe('event log and metrics', () => {
  it('assigns monotonic sequence ids and preserves event context', () => {
    const log = new EventLog();
    const first = log.append('USER_SPEECH_START', {}, { sessionEpoch: 2, stateVersion: 1, timestamp: 100 });
    const second = log.append('INTENT_PATCH_COMMITTED', { existingTasksAtPatch: 5 }, {
      sessionEpoch: 2,
      stateVersion: 2,
      timestamp: 200,
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second).toMatchObject({ sessionEpoch: 2, stateVersion: 2, timestamp: 200 });
    expect(log.after(1).map((event) => event.sequence)).toEqual([2]);
  });

  it('bootstraps a reconnect with one current snapshot and only unseen events', () => {
    const log = new EventLog();
    log.append('TASK_STARTED', { taskId: 'script' }, { sessionEpoch: 1, stateVersion: 1, timestamp: 10 });
    log.append('TASK_COMPLETED', { taskId: 'script' }, { sessionEpoch: 1, stateVersion: 1, timestamp: 20 });

    const bootstrap = buildSseBootstrap(log, 1, () => ({
      state: { version: 1 },
      tasks: [{ id: 'script', status: 'completed' }],
    }));

    expect(bootstrap.snapshot).toEqual({
      state: { version: 1 },
      tasks: [{ id: 'script', status: 'completed' }],
    });
    expect(bootstrap.events.map((event) => event.sequence)).toEqual([2]);
  });

  it('computes realtime metrics from event timestamps and task counts', () => {
    const log = new EventLog();
    log.append('USER_SPEECH_START', {}, { sessionEpoch: 1, stateVersion: 1, timestamp: 100 });
    log.append('USER_SPEECH_END', {}, { sessionEpoch: 1, stateVersion: 1, timestamp: 400 });
    log.append('AGENT_RESPONSE_START', {}, { sessionEpoch: 1, stateVersion: 1, timestamp: 1020 });
    log.append('USER_SPEECH_START', {}, { sessionEpoch: 1, stateVersion: 1, timestamp: 2000 });
    log.append('AGENT_INTERRUPTED', {}, { sessionEpoch: 1, stateVersion: 1, timestamp: 2180 });
    log.append('INTENT_PATCH_COMMITTED', { existingTasksAtPatch: 5 }, {
      sessionEpoch: 1,
      stateVersion: 2,
      timestamp: 3000,
    });
    log.append('TASK_REUSED', { taskId: 'product' }, { sessionEpoch: 1, stateVersion: 2, timestamp: 3100 });
    log.append('TASK_REUSED', { taskId: 'assets' }, { sessionEpoch: 1, stateVersion: 2, timestamp: 3120 });
    log.append('NEW_TASK_GRAPH_STARTED', {}, { sessionEpoch: 1, stateVersion: 2, timestamp: 3430 });

    expect(computeMetrics(log.snapshot())).toEqual({
      firstResponseMs: 620,
      interruptReactionMs: 180,
      replanLatencyMs: 430,
      taskReuseRate: 0.4,
    });
  });
});
