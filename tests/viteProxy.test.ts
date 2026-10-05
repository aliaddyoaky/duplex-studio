import { describe, expect, it } from 'vitest';

import viteConfig from '../vite.config.js';

describe('development media routing', () => {
  it('proxies generated media requests to the runtime server', () => {
    const proxy = viteConfig.server?.proxy as Record<string, unknown>;
    expect(proxy['/api']).toBe('http://localhost:3001');
    expect(proxy['/media']).toBe('http://localhost:3001');
  });
});
