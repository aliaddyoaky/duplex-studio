import { Router } from 'express';
import { z } from 'zod';

import type { DemoOrchestrator } from '../demo/orchestrator.js';

const VersionSchema = z.coerce.number().int().nonnegative();
const RetrySchema = z.object({ taskId: z.string().min(1) });

export function createHistoryRouter(orchestrator: DemoOrchestrator): Router {
  const router = Router();
  router.get('/project/history', async (_request, response, next) => {
    try {
      const state = orchestrator.snapshot().state;
      response.json(state ? await orchestrator.historyStore.list(state.projectId) : []);
    } catch (error) {
      next(error);
    }
  });
  router.get('/project/history/:version', async (request, response, next) => {
    try {
      const state = orchestrator.snapshot().state;
      if (!state) return response.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      const version = VersionSchema.parse(request.params.version);
      const snapshot = await orchestrator.historyStore.get(state.projectId, version);
      if (!snapshot) return response.status(404).json({ error: 'HISTORY_NOT_FOUND' });
      return response.json(snapshot);
    } catch (error) {
      return next(error);
    }
  });
  router.get('/tasks/:taskId', (request, response) => {
    const detail = orchestrator.taskDetail(request.params.taskId);
    if (!detail) return response.status(404).json({ error: 'TASK_NOT_FOUND' });
    return response.json(detail);
  });
  router.post('/project/confirm-script', async (request, response, next) => {
    try {
      const confirmation = z.object({ projectId: z.string().min(1), version: z.number().int().positive() }).safeParse(request.body);
      if (!confirmation.success) return response.status(400).json({ error: '必须明确确认项目和脚本版本' });
      if (orchestrator.snapshot().state?.projectId !== confirmation.data.projectId) return response.status(409).json({ error: '项目已变化，请重新确认' });
      return response.json(await orchestrator.confirmScript(confirmation.data.version));
    } catch (error) {
      return next(error);
    }
  });
  router.post('/project/retry-task', async (request, response, next) => {
    try {
      const { taskId } = RetrySchema.parse(request.body);
      return response.json(await orchestrator.retryTask(taskId));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
