import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AssetLibrary, MAX_UPLOAD_BYTES } from '../src/server/assets/assetLibrary.js';
import { createApp } from '../src/server/app.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function makeLibrary() {
  const root = await mkdtemp(join(tmpdir(), 'duplex-assets-'));
  const library = new AssetLibrary({
    storageDir: join(root, 'uploads'),
    metadataPath: join(root, 'library.json'),
  });
  cleanups.push(async () => {
    await (await import('node:fs/promises')).rm(root, { recursive: true, force: true });
  });
  return { library, root };
}

describe('local asset library', () => {
  it('stores video, image, and audio uploads with safe filenames', async () => {
    const { library, root } = await makeLibrary();
    const video = await library.upload({ filename: '../旅行素材/校园 01.mp4', mimeType: 'video/mp4', bytes: Buffer.from('video') });
    const image = await library.upload({ filename: 'cover.png', mimeType: 'image/png', bytes: Buffer.from('image') });
    const audio = await library.upload({ filename: 'voice.wav', mimeType: 'audio/wav', bytes: Buffer.from('audio') });

    expect(video.type).toBe('video');
    expect(video.filename).toMatch(/^校园_01\.mp4$/);
    expect(image.type).toBe('image');
    expect(audio.type).toBe('audio');
    expect(video.uri).toMatch(/^\/media\/uploads\//);
    await expect(stat(join(root, 'uploads', video.uri.split('/').pop()!))).resolves.toBeTruthy();
    expect(JSON.parse(await readFile(join(root, 'library.json'), 'utf8'))).toHaveLength(3);
  });

  it('rejects unsupported MIME types and uploads larger than 500 MB', async () => {
    const { library } = await makeLibrary();
    await expect(library.upload({ filename: 'notes.txt', mimeType: 'text/plain', bytes: Buffer.from('no') }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_MIME' });
    await expect(library.upload({ filename: 'large.mp4', mimeType: 'video/mp4', bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1) }))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('deduplicates repeated content, supports tags, and searches uploaded assets', async () => {
    const { library } = await makeLibrary();
    const first = await library.upload({ filename: 'campus-walk.mp4', mimeType: 'video/mp4', bytes: Buffer.from('same') });
    const duplicate = await library.upload({ filename: 'renamed.mp4', mimeType: 'video/mp4', bytes: Buffer.from('same') });
    expect(duplicate.id).toBe(first.id);
    expect(await library.list()).toHaveLength(1);

    const tagged = await library.update(first.id, { tags: ['校园', '咖啡'] });
    expect(tagged.tags).toEqual(['校园', '咖啡']);
    expect((await library.search('咖啡'))[0]?.id).toBe(first.id);
  });
});

describe('asset routes', () => {
  it('accepts raw uploads, lists them, patches tags, and serves the file', async () => {
    const { library } = await makeLibrary();
    const app = createApp({ assetLibrary: library });
    const upload = await request(app)
      .post('/api/assets/upload?filename=clip.mp4')
      .set('content-type', 'video/mp4')
      .send(Buffer.from('clip-data'));
    expect(upload.status).toBe(201);
    const asset = upload.body;
    expect(asset.type).toBe('video');

    const listed = await request(app).get('/api/assets?query=clip');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const patched = await request(app).patch(`/api/assets/${asset.id}`).send({ tags: ['产品'] });
    expect(patched.status).toBe(200);
    expect(patched.body.tags).toEqual(['产品']);

    const served = await request(app).get(asset.uri);
    expect(served.status).toBe(200);
    expect(served.body.toString()).toBe('clip-data');
  });
});
