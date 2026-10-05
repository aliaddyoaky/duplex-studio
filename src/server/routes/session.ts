import { Router } from 'express';

import type { LiveTokenProvider } from '../providers/liveTokenProvider.js';

export function createSessionRouter(provider: LiveTokenProvider): Router {
  const router = Router();
  router.post('/session', async (request, response, next) => {
    try {
      const runtimeContext = typeof request.body?.runtimeContext === 'string'
        ? request.body.runtimeContext.slice(0, 24_000)
        : '';
      response.status(201).json(await provider.mint(runtimeContext));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
