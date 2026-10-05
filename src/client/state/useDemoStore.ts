import { useCallback, useEffect, useReducer } from 'react';

import type { RuntimeEvent } from '../../shared/events.js';
import type { ProjectState, TaskRecord } from '../../shared/schemas.js';
import { computeMetrics } from '../../server/runtime/eventLog.js';
import { fetchSnapshot, subscribeRuntime, type DemoApiSnapshot } from '../api.js';

export interface StateDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface DemoViewState {
  snapshot: DemoApiSnapshot | null;
  previousProjectState: ProjectState | null;
  events: RuntimeEvent[];
  staleTaskIds: string[];
  runtimeConnected: boolean;
  error: string | null;
  selectedTaskId: string | null;
}

export type DemoAction =
  | { type: 'SNAPSHOT'; snapshot: DemoApiSnapshot }
  | { type: 'RUNTIME_EVENT'; event: RuntimeEvent }
  | { type: 'CONNECTION'; connected: boolean }
  | { type: 'ERROR'; message: string | null }
  | { type: 'SELECT_TASK'; taskId: string | null };

export function createInitialDemoState(): DemoViewState {
  return {
    snapshot: null,
    previousProjectState: null,
    events: [],
    staleTaskIds: [],
    runtimeConnected: false,
    error: null,
    selectedTaskId: null,
  };
}

export function demoReducer(state: DemoViewState, action: DemoAction): DemoViewState {
  if (action.type === 'SNAPSHOT') {
    if (state.snapshot && state.snapshot.sessionEpoch !== action.snapshot.sessionEpoch) {
      return {
        ...state,
        snapshot: structuredClone(action.snapshot),
        previousProjectState: null,
        events: [],
        staleTaskIds: [],
        error: null,
        selectedTaskId: null,
      };
    }
    const previousProjectState =
      state.snapshot?.state &&
      action.snapshot.state &&
      state.snapshot.state.version !== action.snapshot.state.version
        ? state.snapshot.state
        : state.previousProjectState;
    return { ...state, snapshot: structuredClone(action.snapshot), previousProjectState, error: null };
  }
  if (action.type === 'CONNECTION') return { ...state, runtimeConnected: action.connected };
  if (action.type === 'ERROR') return { ...state, error: action.message };
  if (action.type === 'SELECT_TASK') return { ...state, selectedTaskId: action.taskId };

  if (state.snapshot && action.event.sessionEpoch !== state.snapshot.sessionEpoch) return state;

  if (state.events.some((event) => event.sequence === action.event.sequence)) return state;
  const events = [...state.events, action.event].sort((a, b) => a.sequence - b.sequence);
  const snapshot = state.snapshot ? structuredClone(state.snapshot) : null;
  const taskId = typeof action.event.payload.taskId === 'string' ? action.event.payload.taskId : undefined;
  if (snapshot && taskId) {
    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (task) projectTaskStatus(task, action.event.type);
  }
  const staleTaskIds =
    action.event.type === 'STALE_RESULT_DROPPED' && taskId && !state.staleTaskIds.includes(taskId)
      ? [...state.staleTaskIds, taskId]
      : state.staleTaskIds;
  return { ...state, snapshot, events, staleTaskIds };
}

function projectTaskStatus(task: TaskRecord, eventType: RuntimeEvent['type']): void {
  if (eventType === 'TASK_STARTED') task.status = 'running';
  else if (eventType === 'TASK_COMPLETED' || eventType === 'TASK_REUSED') task.status = 'completed';
  else if (eventType === 'TASK_CANCELLED') task.status = 'cancelled';
  else if (eventType === 'STALE_RESULT_DROPPED') task.status = 'stale';
}

export function selectMetrics(state: DemoViewState) {
  return computeMetrics(state.events);
}

export function selectStateDiff(state: DemoViewState): StateDiffEntry[] {
  const before = state.previousProjectState;
  const after = state.snapshot?.state;
  if (!before || !after) return [];
  const previous = flattenState(before);
  const current = flattenState(after);
  const paths = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...paths]
    .filter((path) => !Object.is(previous[path], current[path]))
    .map((path) => ({ path, before: previous[path], after: current[path] }));
}

function flattenState(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    const idItems = value.every(
      (item) => typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string',
    );
    if (idItems) {
      for (const item of value) {
        const id = (item as { id: string }).id;
        flattenState(item, prefix ? `${prefix}.${id}` : id, output);
      }
    } else output[prefix] = JSON.stringify(value);
    return output;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenState(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (prefix) output[prefix] = value;
  return output;
}

export function useDemoStore() {
  const [state, dispatch] = useReducer(demoReducer, undefined, createInitialDemoState);
  const refresh = useCallback(async () => {
    try {
      dispatch({ type: 'SNAPSHOT', snapshot: await fetchSnapshot() });
    } catch (error) {
      dispatch({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeRuntime({
      onSnapshot: (snapshot) => dispatch({ type: 'SNAPSHOT', snapshot }),
      onEvent: (event) => {
        dispatch({ type: 'RUNTIME_EVENT', event });
        if (['STATE_UPDATED', 'NEW_TASK_GRAPH_STARTED', 'PREVIEW_READY'].includes(event.type)) {
          void refresh();
        }
      },
      onConnection: (connected) => dispatch({ type: 'CONNECTION', connected }),
    });
  }, [refresh]);

  return { state, dispatch, refresh };
}
