import { resolve } from 'node:path';
import express, { type Express } from 'express';

import { createEventsRouter, type RuntimeSnapshot } from './routes/events.js';
import { createIntentRouter } from './routes/intent.js';
import { createProjectRouter } from './routes/project.js';
import { createSessionRouter } from './routes/session.js';
import type { EventLog } from './runtime/eventLog.js';
import type { LiveTokenProvider } from './providers/liveTokenProvider.js';
import type { DemoOrchestrator } from './demo/orchestrator.js';
import { AssetLibrary } from './assets/assetLibrary.js';
import { createAssetsRouter } from './routes/assets.js';
import { createHistoryRouter } from './routes/history.js';

export interface AppDeps {
  eventLog?: EventLog;
  getSnapshot?: () => RuntimeSnapshot;
  liveTokenProvider?: LiveTokenProvider;
  demoOrchestrator?: DemoOrchestrator;
  assetLibrary?: AssetLibrary;
}

export function createApp(_deps: AppDeps = {}): Express {
  const app = express();
  app.use(express.json());
  app.use('/media/artifacts', express.static(resolve('data/artifacts')));
  app.use('/media/assets', express.static(resolve('demo/assets')));
  const assetLibrary = _deps.assetLibrary ?? new AssetLibrary();
  app.use('/media/uploads', express.static(assetLibrary.storageDir));
  app.use('/api', createAssetsRouter(assetLibrary));
  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });
  if (_deps.eventLog && _deps.getSnapshot) {
    app.use('/api', createEventsRouter(_deps.eventLog, _deps.getSnapshot));
  }
  if (_deps.liveTokenProvider) {
    app.use('/api', createSessionRouter(_deps.liveTokenProvider));
  }
  if (_deps.demoOrchestrator) {
    app.use('/api', createIntentRouter(_deps.demoOrchestrator));
    app.use('/api', createProjectRouter(_deps.demoOrchestrator));
    app.use('/api', createHistoryRouter(_deps.demoOrchestrator));
  }
  return app;
}
