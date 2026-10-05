import type {
  RuntimeEvent,
  RuntimeEventType,
  RuntimeMetrics,
} from '../../shared/events.js';

export interface EventContext {
  sessionEpoch: number;
  stateVersion?: number;
  timestamp?: number;
}

type EventListener = (event: RuntimeEvent) => void;
type EventPersist = (event: RuntimeEvent) => void;

export class EventLog {
  private readonly events: RuntimeEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  constructor(private readonly persist?: EventPersist) {}

  append(
    type: RuntimeEventType,
    payload: Record<string, unknown>,
    context: EventContext,
  ): RuntimeEvent {
    const event: RuntimeEvent = {
      sequence: this.events.length + 1,
      type,
      timestamp: context.timestamp ?? Date.now(),
      sessionEpoch: context.sessionEpoch,
      stateVersion: context.stateVersion,
      payload,
    };
    this.events.push(event);
    this.persist?.(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  snapshot(): RuntimeEvent[] {
    return this.events.map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  restore(events: RuntimeEvent[]): void {
    this.events.length = 0;
    for (const event of events) this.events.push({ ...event, payload: { ...event.payload } });
  }

  after(sequence: number): RuntimeEvent[] {
    return this.snapshot().filter((event) => event.sequence > sequence);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function firstTimestamp(events: RuntimeEvent[], type: RuntimeEventType, after = -Infinity): number | null {
  return events.find((event) => event.type === type && event.timestamp >= after)?.timestamp ?? null;
}

function lastBefore(events: RuntimeEvent[], type: RuntimeEventType, before: number): number | null {
  return [...events]
    .reverse()
    .find((event) => event.type === type && event.timestamp <= before)?.timestamp ?? null;
}

export function computeMetrics(events: RuntimeEvent[]): RuntimeMetrics {
  const firstSpeechEnd = firstTimestamp(events, 'USER_SPEECH_END');
  const firstResponse =
    firstSpeechEnd === null ? null : firstTimestamp(events, 'AGENT_RESPONSE_START', firstSpeechEnd);

  const firstInterrupted = firstTimestamp(events, 'AGENT_INTERRUPTED');
  const speechStartBeforeInterrupt =
    firstInterrupted === null ? null : lastBefore(events, 'USER_SPEECH_START', firstInterrupted);

  const patches = events.filter((event) => event.type === 'INTENT_PATCH_COMMITTED');
  const latestPatch = patches.at(-1) ?? null;
  const graphStarted =
    latestPatch === null ? null : firstTimestamp(events, 'NEW_TASK_GRAPH_STARTED', latestPatch.timestamp);
  const existingTasks = Number(latestPatch?.payload.existingTasksAtPatch ?? 0);
  const nextPatchTimestamp = latestPatch
    ? events.find(
        (event) => event.type === 'INTENT_PATCH_COMMITTED' && event.sequence > latestPatch.sequence,
      )?.timestamp ?? Infinity
    : Infinity;
  const reused = latestPatch
    ? events.filter(
        (event) =>
          event.type === 'TASK_REUSED' &&
          event.timestamp >= latestPatch.timestamp &&
          event.timestamp < nextPatchTimestamp,
      ).length
    : 0;

  return {
    firstResponseMs:
      firstSpeechEnd === null || firstResponse === null ? null : firstResponse - firstSpeechEnd,
    interruptReactionMs:
      firstInterrupted === null || speechStartBeforeInterrupt === null
        ? null
        : firstInterrupted - speechStartBeforeInterrupt,
    replanLatencyMs:
      latestPatch === null || graphStarted === null ? null : graphStarted - latestPatch.timestamp,
    taskReuseRate: existingTasks > 0 ? reused / existingTasks : null,
  };
}
