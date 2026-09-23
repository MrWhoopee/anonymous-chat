import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: null as { getIdToken: () => Promise<string> } | null,
  },
}));

vi.mock('./firebase', () => ({ auth: mocks.auth }));

import { sendMessage } from './api';

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  };
}

describe('sendMessage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.auth.currentUser = { getIdToken: vi.fn(async () => 'token-abc') };
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the text with the ID token as a Bearer header', async () => {
    fetchMock.mockResolvedValue(fakeResponse(201, { id: 'm1' }));

    await sendMessage('hello');

    expect(fetchMock).toHaveBeenCalledWith('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-abc' },
      body: JSON.stringify({ text: 'hello' }),
    });
  });

  it('throws the server error message', async () => {
    fetchMock.mockResolvedValue(fakeResponse(400, { error: 'text must be 1-500 characters after trimming' }));

    await expect(sendMessage('')).rejects.toThrow('text must be 1-500 characters after trimming');
  });

  it('throws a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(fakeResponse(502, undefined));

    await expect(sendMessage('hi')).rejects.toThrow('Request failed (502)');
  });

  it('throws when there is no signed-in user', async () => {
    mocks.auth.currentUser = null;

    await expect(sendMessage('hi')).rejects.toThrow('Not signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
