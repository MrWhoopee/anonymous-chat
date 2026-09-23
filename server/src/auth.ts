import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TokenVerifier } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { uid: string } | null;
  }
}

const BEARER = /^Bearer (\S+)$/;

// Runs as an onRequest hook, i.e. before body parsing and validation,
// so unauthenticated requests always get 401 rather than 400.
export function createAuthHook(verifier: TokenVerifier) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const match = request.headers.authorization?.match(BEARER);
    if (!match) {
      return reply.status(401).send({ error: 'Missing or malformed Authorization header' });
    }

    try {
      const { uid } = await verifier.verifyIdToken(match[1]);
      request.user = { uid };
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  };
}
