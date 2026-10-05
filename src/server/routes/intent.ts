import { Router } from 'express';

import { IntentPatchSchema } from '../../shared/schemas.js';
import type { DemoOrchestrator } from '../demo/orchestrator.js';

export function createIntentRouter(orchestrator: DemoOrchestrator): Router {
  const router = Router();
  router.post('/intent/patch', async (request, response, next) => {
    try {
      const result = await orchestrator.applyPatch(IntentPatchSchema.parse(request.body));
      response.json({ ...result, stateVersion: result.current.version });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
