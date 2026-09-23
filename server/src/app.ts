import Fastify, { type FastifyError } from 'fastify';
import { messagesRoutes } from './routes/messages.js';
import type { AppDeps } from './types.js';

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(deps: AppDeps, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      // Fastify defaults would strip unknown fields and coerce types
      // (e.g. text: 123 -> "123"). We want both rejected with 400.
      customOptions: { removeAdditional: false, coerceTypes: false },
    },
  });

  app.decorateRequest('user', null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
    return reply.status(status).send({ error: error.message });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.register(messagesRoutes(deps));

  return app;
}
