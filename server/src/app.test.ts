import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';

function createFakeDeps() {
  return {
    auth: {
      verifyIdToken: vi.fn(async (token: string) => {
        if (token === 'valid-token') return { uid: 'user-123' };
        throw new Error('invalid token');
      }),
    },
    messages: { add: vi.fn(async () => ({ id: 'msg-1' })) },
  };
}

function setup() {
  const deps = createFakeDeps();
  const app = buildApp(deps);

  const post = (payload: unknown, headers: Record<string, string> = { authorization: 'Bearer valid-token' }) =>
    app.inject({ method: 'POST', url: '/api/messages', payload: payload as object, headers });

  return { app, deps, post };
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const { app } = setup();

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('POST /api/messages — auth', () => {
  it('returns 401 without Authorization header', async () => {
    const { post, deps } = setup();

    const res = await post({ text: 'hi' }, {});

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: expect.any(String) });
    expect(deps.messages.add).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is rejected', async () => {
    const { post } = setup();

    const res = await post({ text: 'hi' }, { authorization: 'Bearer bad-token' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it.each([['bearer valid-token'], ['Bearer '], ['Basic abc'], ['valid-token']])(
    'returns 401 for malformed header %j',
    async (header) => {
      const { post } = setup();

      const res = await post({ text: 'hi' }, { authorization: header });

      expect(res.statusCode).toBe(401);
    },
  );

  it('checks auth before validating the body', async () => {
    const { post } = setup();

    const res = await post({}, {});

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/messages — validation', () => {
  it.each([
    ['empty text', { text: '' }],
    ['whitespace-only text', { text: '   \n\t ' }],
    ['text longer than 500 chars', { text: 'a'.repeat(501) }],
    ['missing text', {}],
  ])('returns 400 for %s', async (_name, payload) => {
    const { post, deps } = setup();

    const res = await post(payload);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
    expect(deps.messages.add).not.toHaveBeenCalled();
  });

  it('rejects non-string text instead of coercing', async () => {
    const { post, deps } = setup();

    const res = await post({ text: 123 });

    expect(res.statusCode).toBe(400);
    expect(deps.messages.add).not.toHaveBeenCalled();
  });

  it('rejects extra fields', async () => {
    const { post, deps } = setup();

    const res = await post({ text: 'hi', uid: 'someone-else' });

    expect(res.statusCode).toBe(400);
    expect(deps.messages.add).not.toHaveBeenCalled();
  });

  it('returns 400 in { error } shape for malformed JSON', async () => {
    const { app } = setup();

    const res = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: '{"text":',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it('accepts exactly 500 characters after trimming', async () => {
    const { post } = setup();

    const res = await post({ text: `  ${'a'.repeat(500)}  ` });

    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/messages — success and failures', () => {
  it('stores trimmed text with uid from token and returns 201 { id }', async () => {
    const { post, deps } = setup();

    const res = await post({ text: '  hello  ' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'msg-1' });
    expect(deps.auth.verifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(deps.messages.add).toHaveBeenCalledWith({ text: 'hello', uid: 'user-123' });
  });

  it('returns 500 without leaking details when storing fails', async () => {
    const { post, deps } = setup();
    deps.messages.add.mockRejectedValueOnce(new Error('firestore down: secret-detail'));

    const res = await post({ text: 'hello' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal Server Error' });
    expect(res.body).not.toContain('secret-detail');
  });
});
