import { Router } from 'express';

import type { RuntimeEvent } from '../../shared/events.js';
import type { EventLog } from '../runtime/eventLog.js';

export interface RuntimeSnapshot {
  state: unknown;
  tasks: unknown[];
  artifacts?: unknown[];
  mode?: 'LIVE' | 'HYBRID' | 'REPLAY';
  sessionEpoch?: number;
  graph?: unknown;
  rejectedArtifacts?: unknown[];
}

export interface SseBootstrap {
  snapshot: RuntimeSnapshot;
  events: RuntimeEvent[];
}

export function buildSseBootstrap(
  eventLog: EventLog,
  afterSequence: number,
  getSnapshot: () => RuntimeSnapshot,
): SseBootstrap {
  return {
    snapshot: getSnapshot(),
    events: eventLog.after(afterSequence),
  };
}

function sseFrame(event: string, data: unknown, id?: number): string {
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createEventsRouter(eventLog: EventLog, getSnapshot: () => RuntimeSnapshot): Router {
  const router = Router();

  router.get('/project/snapshot', (_request, response) => {
    response.json(getSnapshot());
  });

  router.get('/events', (request, response) => {
    const headerSequence = Number(request.header('last-event-id') ?? 0);
    const querySequence = Number(request.query.after ?? 0);
    const afterSequence = Number.isFinite(headerSequence) && headerSequence > 0 ? headerSequence : querySequence;
    const bootstrap = buildSseBootstrap(eventLog, Number.isFinite(afterSequence) ? afterSequence : 0, getSnapshot);

    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.flushHeaders();
    response.write(sseFrame('snapshot', bootstrap.snapshot));
    for (const event of bootstrap.events) response.write(sseFrame('runtime', event, event.sequence));

    const unsubscribe = eventLog.subscribe((event) => {
      response.write(sseFrame('runtime', event, event.sequence));
    });
    request.on('close', unsubscribe);
  });

  return router;
}
