export type RuntimeEventType =
  | 'USER_SPEECH_START'
  | 'USER_SPEECH_END'
  | 'AGENT_RESPONSE_START'
  | 'AGENT_INTERRUPTED'
  | 'INTENT_PATCH_COMMITTED'
  | 'STATE_UPDATED'
  | 'NEW_TASK_GRAPH_STARTED'
  | 'TASK_STARTED'
  | 'TASK_REUSED'
  | 'TASK_CANCELLED'
  | 'TASK_COMPLETED'
  | 'STALE_RESULT_DROPPED'
  | 'VIDEO_JOB_SUBMITTED'
  | 'VIDEO_JOB_PROGRESS'
  | 'VIDEO_JOB_COMPLETED'
  | 'PREVIEW_READY';

export interface RuntimeEvent {
  sequence: number;
  type: RuntimeEventType;
  timestamp: number;
  sessionEpoch: number;
  stateVersion?: number;
  payload: Record<string, unknown>;
}

export interface RuntimeMetrics {
  firstResponseMs: number | null;
  interruptReactionMs: number | null;
  replanLatencyMs: number | null;
  taskReuseRate: number | null;
}
