import Fastify from 'fastify';
import type { AppDeps } from './types.js';

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(_deps: AppDeps, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      // Fastify defaults would strip unknown fields and coerce types
      // (e.g. text: 123 -> "123"). We want both rejected with 400.
      customOptions: { removeAdditional: false, coerceTypes: false },
    },
  });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
