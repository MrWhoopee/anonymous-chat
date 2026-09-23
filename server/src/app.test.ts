import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';

function createFakeDeps() {
  return {
    auth: { verifyIdToken: vi.fn(async (_token: string) => ({ uid: 'user-123' })) },
    messages: { add: vi.fn(async () => ({ id: 'msg-1' })) },
  };
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp(createFakeDeps());

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
