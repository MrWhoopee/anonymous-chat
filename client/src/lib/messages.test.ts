import { describe, expect, it } from 'vitest';
import { toMessage } from './messages';

describe('toMessage', () => {
  it('maps a Firestore document to a Message', () => {
    const date = new Date('2026-09-23T10:00:00Z');

    const message = toMessage('m1', {
      text: 'hello',
      uid: 'user-1',
      createdAt: { toDate: () => date },
    });

    expect(message).toEqual({ id: 'm1', text: 'hello', uid: 'user-1', createdAt: date });
  });

  it('returns createdAt: null when the timestamp is missing or null', () => {
    expect(toMessage('m2', { text: 'a', uid: 'u' }).createdAt).toBeNull();
    expect(toMessage('m3', { text: 'a', uid: 'u', createdAt: null }).createdAt).toBeNull();
  });
});
