import type { Message } from '../types';

export const MESSAGE_LIMIT = 50;

interface TimestampLike {
  toDate(): Date;
}

export function toMessage(id: string, data: Record<string, unknown>): Message {
  const createdAt = data.createdAt as TimestampLike | null | undefined;
  return {
    id,
    text: String(data.text ?? ''),
    uid: String(data.uid ?? ''),
    createdAt: createdAt ? createdAt.toDate() : null,
  };
}
