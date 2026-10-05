import { Router } from 'express';
import { z } from 'zod';

import { ProjectStateSchema } from '../../shared/schemas.js';
import type { DemoMode } from '../demo/fallback.js';
import type { DemoOrchestrator } from '../demo/orchestrator.js';

const BriefSchema = ProjectStateSchema.shape.brief;
const ModeSchema = z.enum(['LIVE', 'HYBRID', 'REPLAY']);

export function createProjectRouter(orchestrator: DemoOrchestrator): Router {
  const router = Router();
  router.post('/project', async (request, response, next) => {
    try {
      response.status(201).json(await orchestrator.createProject(BriefSchema.parse(request.body)));
    } catch (error) {
      next(error);
    }
  });
  router.post('/demo/reset', (_request, response) => {
    response.json(orchestrator.reset());
  });
  router.post('/demo/mode', (request, response, next) => {
    try {
      const mode = ModeSchema.parse(request.body?.mode) as DemoMode;
      response.json({ mode: orchestrator.setMode(mode) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
