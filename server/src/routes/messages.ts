import type { FastifyPluginAsync } from 'fastify';
import { createAuthHook } from '../auth.js';
import type { AppDeps } from '../types.js';

export const MAX_MESSAGE_LENGTH = 500;

interface CreateMessageBody {
  text: string;
}

const createMessageSchema = {
  body: {
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
    },
  },
} as const;

export function messagesRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: CreateMessageBody }>(
      '/api/messages',
      { onRequest: createAuthHook(deps.auth), schema: createMessageSchema },
      async (request, reply) => {
        const text = request.body.text.trim();
        if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
          return reply
            .status(400)
            .send({ error: `text must be 1-${MAX_MESSAGE_LENGTH} characters after trimming` });
        }

        const { id } = await deps.messages.add({ text, uid: request.user!.uid });
        return reply.status(201).send({ id });
      },
    );
  };
}
