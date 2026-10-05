import type { RuntimeEvent } from '../shared/events.js';
import type { Artifact, IntentPatch, ProjectState, TaskRecord } from '../shared/schemas.js';
import type { TaskGraph } from '../server/runtime/taskGraph.js';

export type DemoMode = 'LIVE' | 'HYBRID' | 'REPLAY';

export interface DemoApiSnapshot {
  state: ProjectState | null;
  tasks: TaskRecord[];
  artifacts: Artifact[];
  mode: DemoMode;
  sessionEpoch: number;
  graph?: TaskGraph | null;
  rejectedArtifacts?: Array<{ artifact: Artifact; disposition: string }>;
}

export interface HistorySummary {
  version: number;
  phase: string;
  savedAt: string;
  taskCount: number;
  artifactCount: number;
}

export interface TaskDetail {
  task: TaskRecord;
  events: RuntimeEvent[];
}

export async function fetchSnapshot(): Promise<DemoApiSnapshot> {
  return requestJson<DemoApiSnapshot>('/api/project/snapshot');
}

export async function createProject(brief: ProjectState['brief']): Promise<ProjectState> {
  return requestJson<ProjectState>('/api/project', { method: 'POST', body: JSON.stringify(brief) });
}

export async function applyIntentPatch(patch: IntentPatch): Promise<{ stateVersion: number }> {
  return requestJson<{ stateVersion: number }>('/api/intent/patch', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export async function confirmScript(): Promise<ProjectState> {
  return requestJson<ProjectState>('/api/project/confirm-script', { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchTaskDetail(taskId: string): Promise<TaskDetail> {
  return requestJson<TaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function retryTask(taskId: string): Promise<TaskRecord> {
  return requestJson<TaskRecord>('/api/project/retry-task', { method: 'POST', body: JSON.stringify({ taskId }) });
}

export async function fetchHistory(version?: number): Promise<HistorySummary[] | Record<string, unknown>> {
  return requestJson(version === undefined ? '/api/project/history' : `/api/project/history/${version}`);
}

export async function resetDemo(): Promise<{ sessionEpoch: number; abortedTasks: number }> {
  return requestJson('/api/demo/reset', { method: 'POST' });
}

export async function setDemoMode(mode: DemoMode): Promise<{ mode: DemoMode }> {
  return requestJson('/api/demo/mode', { method: 'POST', body: JSON.stringify({ mode }) });
}

export function subscribeRuntime(callbacks: {
  onSnapshot(snapshot: DemoApiSnapshot): void;
  onEvent(event: RuntimeEvent): void;
  onConnection(connected: boolean): void;
}): () => void {
  const source = new EventSource('/api/events');
  source.addEventListener('open', () => callbacks.onConnection(true));
  source.addEventListener('error', () => callbacks.onConnection(false));
  source.addEventListener('snapshot', (event) => {
    callbacks.onSnapshot(JSON.parse((event as MessageEvent).data) as DemoApiSnapshot);
  });
  source.addEventListener('runtime', (event) => {
    callbacks.onEvent(JSON.parse((event as MessageEvent).data) as RuntimeEvent);
  });
  return () => source.close();
}

export function mediaUrl(uri: string): string {
  if (/^(https?:|blob:|data:)/.test(uri)) return uri;
  const normalized = uri.replaceAll('\\', '/');
  if (normalized.startsWith('/media/')) return normalized;
  const filename = normalized.split('/').at(-1) ?? normalized;
  if (normalized.includes('data/uploads/')) return `/media/uploads/${encodeURIComponent(filename)}`;
  return normalized.includes('demo/assets/')
    ? `/media/assets/${encodeURIComponent(filename)}`
    : `/media/artifacts/${encodeURIComponent(filename)}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${message || response.statusText}`);
  }
  return (await response.json()) as T;
}
