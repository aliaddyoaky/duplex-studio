import express, { Router } from 'express';
import { z } from 'zod';

import { AssetLibrary, AssetLibraryError, MAX_UPLOAD_BYTES } from '../assets/assetLibrary.js';

const TagsSchema = z.object({ tags: z.array(z.string()).max(32) });

function sendAssetError(error: unknown, response: express.Response, next: express.NextFunction): void {
  if (!(error instanceof AssetLibraryError)) {
    next(error);
    return;
  }
  const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'UNSUPPORTED_MIME' || error.code === 'INVALID_FILENAME' ? 400 : 413;
  response.status(status).json({ error: error.code, message: error.message });
}

export function createAssetsRouter(library: AssetLibrary): Router {
  const router = Router();
  router.post(
    '/assets/upload',
    express.raw({ type: ['video/*', 'image/*', 'audio/*', 'application/octet-stream'], limit: MAX_UPLOAD_BYTES }),
    async (request, response, next) => {
      try {
        const mimeType = String(request.headers['x-mime-type'] ?? request.headers['content-type'] ?? '');
        const filename = String(request.headers['x-filename'] ?? request.query.filename ?? 'upload');
        let bytes: Buffer;
        if (Buffer.isBuffer(request.body)) bytes = request.body;
        else if (request.body?.bytesBase64) bytes = Buffer.from(String(request.body.bytesBase64), 'base64');
        else bytes = Buffer.alloc(0);
        response.status(201).json(await library.upload({ filename, mimeType, bytes }));
      } catch (error) {
        sendAssetError(error, response, next);
      }
    },
  );
  router.get('/assets', async (request, response, next) => {
    try {
      const query = typeof request.query.query === 'string' ? request.query.query : undefined;
      const type = typeof request.query.type === 'string' ? request.query.type as 'image' | 'video' | 'audio' : undefined;
      response.json(query ? await library.search(query) : await library.list({ type }));
    } catch (error) {
      sendAssetError(error, response, next);
    }
  });
  router.patch('/assets/:id', async (request, response, next) => {
    try {
      response.json(await library.update(request.params.id, TagsSchema.parse(request.body)));
    } catch (error) {
      sendAssetError(error, response, next);
    }
  });
  return router;
}
