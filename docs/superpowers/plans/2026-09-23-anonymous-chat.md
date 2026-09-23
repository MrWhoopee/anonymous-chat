# Anonymous Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-room anonymous chat: React client signs in with Firebase Anonymous Auth, sends messages through a Fastify backend that writes to Firestore, and receives messages in realtime via Firestore `onSnapshot`.

**Architecture:** npm workspaces monorepo with `server/` (Fastify + firebase-admin, dependencies injected into `buildApp()` so tests use fakes instead of real Firebase) and `client/` (React + Vite). Writes go only through `POST /api/messages` (token verified, `uid` from token, server timestamp); reads go client → Firestore directly, guarded by Security Rules. Docker Compose runs server + nginx-served client, nginx proxies `/api`.

**Tech Stack:** Node 22, TypeScript, Fastify 5, firebase-admin, React 19, Vite, Firebase JS SDK (modular), Vitest, React Testing Library, Docker Compose, nginx.

**Spec:** `docs/superpowers/specs/2026-09-23-anonymous-chat-design.md`

## Global Constraints

- Node `>=22` (uses `process.loadEnvFile`). Verified locally: v22.19.0, npm 10.9.3, Docker 29.2.1.
- Firebase project ID: `anonymous-chat-4d8fd`. Firestore collection: `messages`, fields `text`, `uid`, `createdAt`.
- Message text: trimmed, 1–500 characters (`MAX_MESSAGE_LENGTH = 500`). Client shows the latest 50 messages (`MESSAGE_LIMIT = 50`).
- All backend error responses have the shape `{ error: string }`. 401 for auth problems, 400 for invalid input, 500 without leaking details.
- `uid` is taken only from the verified ID token, never from the request body. `createdAt` is `FieldValue.serverTimestamp()`.
- Client never writes to Firestore; rules: `read: if request.auth != null`, `write: if false`.
- Client always calls relative `/api/...`; Vite proxies in dev, nginx in Docker. No CORS.
- Client Firebase config uses only `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. No Analytics.
- Secrets (`server/.env`, service-account JSON) never committed and never baked into Docker images.
- UI copy (exact strings): `Connecting…`, `Couldn't connect`, `Retry`, `Couldn't load messages`, `You`, `Your ID: <uid>`, `No messages yet. Say hi!`, input label `Message`, button `Send`.
- Styling: plain CSS, no UI library, dark theme only with deep navy → purple gradients, restrained. Use the `frontend-design` skill in Task 9 (user request).
- Commit messages end with the session attribution trailer lines.
- Shell: commands below are bash (Git Bash on Windows), run from the repo root `C:\Projects\anonymous-chat` unless stated.

## Review Focus

1. **Enter pressed repeatedly while a send is in flight** → exactly one POST. Pinned in Task 8 (`sends only once on rapid double submit`).
2. **`text` sent as a non-string (e.g. `123`)** → 400 and nothing stored; Fastify's default Ajv would coerce it to `"123"`. Pinned in Task 3 (`rejects non-string text instead of coercing`).
3. **Extra body fields such as a spoofed `uid`** → 400; Fastify's default Ajv would silently strip them. Pinned in Task 3 (`rejects extra fields`, `uses uid from token`).
4. **Malformed JSON body / malformed Authorization header (`bearer x`, `Bearer ` with empty token)** → 400 / 401 in `{ error }` shape, and auth is checked before body validation. Pinned in Task 3.
5. **Firestore document with missing/null `createdAt`** → message renders without a time, no crash. Pinned in Task 5 (`toMessage`) and Task 7 (`MessageItem`).

---

## File Structure

```
anonymous-chat/
├─ package.json                 workspaces, root scripts (dev/test/build/typecheck)
├─ .gitignore
├─ .dockerignore
├─ .env.example                 VITE_FIREBASE_* for Docker build args
├─ firestore.rules
├─ firebase.json                points CLI to firestore.rules
├─ .firebaserc                  default project
├─ docker-compose.yml
├─ README.md
├─ server/
│  ├─ package.json
│  ├─ tsconfig.json             typecheck incl. tests (noEmit)
│  ├─ tsconfig.build.json       emit to dist/, excludes tests
│  ├─ Dockerfile
│  ├─ .env.example
│  └─ src/
│     ├─ types.ts               TokenVerifier, MessageStore, AppDeps, NewMessage
│     ├─ config.ts              loadConfig(env) → Config (fail fast)
│     ├─ config.test.ts
│     ├─ auth.ts                createAuthHook(verifier) + FastifyRequest.user typing
│     ├─ routes/messages.ts     POST /api/messages, MAX_MESSAGE_LENGTH
│     ├─ app.ts                 buildApp(deps, options) — no listen
│     ├─ app.test.ts
│     ├─ firebase.ts            createFirebaseDeps(config) → AppDeps (real firebase-admin)
│     └─ index.ts               entrypoint: env → config → deps → listen
└─ client/
   ├─ package.json
   ├─ tsconfig.json
   ├─ vite.config.ts            react plugin, /api proxy, vitest config
   ├─ index.html
   ├─ Dockerfile
   ├─ nginx.conf
   ├─ .env.example
   └─ src/
      ├─ main.tsx
      ├─ App.tsx
      ├─ index.css
      ├─ vite-env.d.ts          typed import.meta.env
      ├─ types.ts               Message
      ├─ test/setup.ts          jest-dom + cleanup
      ├─ lib/firebase.ts        initializeApp → auth, db
      ├─ lib/messages.ts        toMessage(), MESSAGE_LIMIT
      ├─ lib/messages.test.ts
      ├─ lib/api.ts             sendMessage(text)
      ├─ lib/api.test.ts
      ├─ hooks/useAnonymousAuth.ts
      ├─ hooks/useMessages.ts
      └─ components/
         ├─ ChatRoom.tsx / ChatRoom.test.tsx
         ├─ MessageList.tsx
         ├─ MessageItem.tsx / MessageItem.test.tsx
         ├─ MessageInput.tsx / MessageInput.test.tsx
         └─ UserIdFooter.tsx
```

Note on testing approach: the spec says "mock firebase-admin". This plan does that through dependency injection — `buildApp({ auth, messages })` receives fake `verifyIdToken` / `add` functions (`vi.fn()`), and only `firebase.ts` touches the real SDK. Same coverage, no module-mocking fragility.

---

### Task 1: Monorepo root + server skeleton with health endpoint

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`
- Create: `server/src/types.ts`, `server/src/app.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `buildApp(deps: AppDeps, options?: BuildAppOptions)` returning a Fastify instance; `GET /api/health` → `200 { ok: true }`; types `TokenVerifier`, `NewMessage`, `MessageStore`, `AppDeps` in `server/src/types.ts`.

- [ ] **Step 1: Create root `package.json`** (only `server` workspace for now; `client` is added in Task 5)

```json
{
  "name": "anonymous-chat",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "workspaces": [
    "server"
  ],
  "scripts": {
    "dev": "concurrently -n server,client -c blue,magenta \"npm run dev -w server\" \"npm run dev -w client\"",
    "build": "npm run build --workspaces",
    "test": "npm test --workspaces",
    "typecheck": "npm run typecheck --workspaces"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
dist/
coverage/

# env files (examples are committed)
.env
.env.*
!.env.example

# Firebase service-account keys
*-firebase-adminsdk-*.json
service-account*.json
```

- [ ] **Step 3: Create `server/package.json`**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 4: Install server dependencies and root dev tool**

Run:
```bash
npm install -w server fastify firebase-admin
npm install -D -w server typescript tsx vitest @types/node
npm install -D concurrently
```
Expected: `package-lock.json` created at root, `node_modules/` at root, no errors.

- [ ] **Step 5: Create `server/tsconfig.json` and `server/tsconfig.build.json`**

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`server/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false
  },
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 6: Create `server/src/types.ts`**

```ts
export interface TokenVerifier {
  verifyIdToken(token: string): Promise<{ uid: string }>;
}

export interface NewMessage {
  text: string;
  uid: string;
}

export interface MessageStore {
  add(message: NewMessage): Promise<{ id: string }>;
}

export interface AppDeps {
  auth: TokenVerifier;
  messages: MessageStore;
}
```

- [ ] **Step 7: Write the failing test `server/src/app.test.ts`**

```ts
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
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — cannot resolve `./app.js`.

- [ ] **Step 9: Create `server/src/app.ts`**

```ts
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
```

- [ ] **Step 10: Run tests and typecheck**

Run: `npm test -w server && npm run typecheck -w server`
Expected: 1 test PASS; typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore server
git commit -m "feat(server): scaffold Fastify app with health endpoint"
```

---

### Task 2: Server config loader

**Files:**
- Create: `server/src/config.ts`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config` where
  `Config = { port: number; firebase: { projectId: string; clientEmail: string; privateKey: string } }`. Throws `Error` whose message lists missing variables.

- [ ] **Step 1: Write the failing test `server/src/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const validEnv = {
  FIREBASE_PROJECT_ID: 'anonymous-chat-4d8fd',
  FIREBASE_CLIENT_EMAIL: 'svc@anonymous-chat-4d8fd.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
};

describe('loadConfig', () => {
  it('reads firebase credentials and defaults port to 3000', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3000);
    expect(config.firebase.projectId).toBe('anonymous-chat-4d8fd');
    expect(config.firebase.clientEmail).toBe(validEnv.FIREBASE_CLIENT_EMAIL);
  });

  it('converts escaped \\n in the private key into real newlines', () => {
    const config = loadConfig(validEnv);

    expect(config.firebase.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
    );
  });

  it('uses PORT when provided', () => {
    expect(loadConfig({ ...validEnv, PORT: '4000' }).port).toBe(4000);
  });

  it('throws listing every missing variable', () => {
    expect(() => loadConfig({ FIREBASE_PROJECT_ID: 'x' })).toThrow(
      'Missing required environment variables: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
  });

  it('throws on an invalid PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow('Invalid PORT: abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 3: Create `server/src/config.ts`**

```ts
export interface Config {
  port: number;
  firebase: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };
}

const REQUIRED = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  return {
    port,
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID!,
      clientEmail: env.FIREBASE_CLIENT_EMAIL!,
      // .env files store the key on one line with literal "\n" sequences
      privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w server && npm run typecheck -w server`
Expected: all tests PASS (6 total); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts
git commit -m "feat(server): add env config loader with fail-fast validation"
```

---

### Task 3: Auth hook, error handler and `POST /api/messages`

**Files:**
- Create: `server/src/auth.ts`, `server/src/routes/messages.ts`
- Modify: `server/src/app.ts` (full replacement below)
- Test: `server/src/app.test.ts` (full replacement below)

**Interfaces:**
- Consumes: `AppDeps`, `TokenVerifier` from Task 1.
- Produces: `createAuthHook(verifier: TokenVerifier)` (Fastify `onRequest` hook, sets `request.user = { uid }`); `messagesRoutes(deps: AppDeps)` plugin; `MAX_MESSAGE_LENGTH = 500`. API: `POST /api/messages` body `{ text }` → `201 { id }`.

- [ ] **Step 1: Replace `server/src/app.test.ts` with the full failing suite**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: health + config PASS; `POST /api/messages` tests FAIL with 404.

- [ ] **Step 3: Create `server/src/auth.ts`**

```ts
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
```

- [ ] **Step 4: Create `server/src/routes/messages.ts`**

```ts
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
```

- [ ] **Step 5: Replace `server/src/app.ts`**

```ts
import Fastify from 'fastify';
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

  app.setErrorHandler((error, request, reply) => {
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
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w server && npm run typecheck -w server`
Expected: all tests PASS; typecheck exits 0. If `error.statusCode` is typed `unknown` by the installed Fastify version, annotate the handler parameter as `(error: FastifyError, ...)` importing `type FastifyError` from `fastify`.

- [ ] **Step 7: Commit**

```bash
git add server/src
git commit -m "feat(server): add POST /api/messages with token auth and validation"
```

---

### Task 4: Firebase wiring and server entrypoint

**Files:**
- Create: `server/src/firebase.ts`, `server/src/index.ts`, `server/.env.example`

**Interfaces:**
- Consumes: `Config` (Task 2), `AppDeps` (Task 1), `buildApp` (Task 3).
- Produces: `createFirebaseDeps(config: Config['firebase']): AppDeps`; runnable server (`npm run dev -w server`, `npm start -w server`).

This task is glue around the real SDK; it is verified by typecheck, build and a startup smoke check rather than unit tests (the logic it wires is already covered).

- [ ] **Step 1: Create `server/src/firebase.ts`**

```ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Config } from './config.js';
import type { AppDeps } from './types.js';

export function createFirebaseDeps(firebase: Config['firebase']): AppDeps {
  const app = initializeApp({ credential: cert(firebase) });
  const db = getFirestore(app);

  return {
    auth: getAuth(app),
    messages: {
      async add(message) {
        const ref = await db.collection('messages').add({
          ...message,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { id: ref.id };
      },
    },
  };
}
```

- [ ] **Step 2: Create `server/src/index.ts`**

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createFirebaseDeps } from './firebase.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. in Docker, where env comes from env_file) — use process.env as is.
}

try {
  const config = loadConfig();
  const app = buildApp(createFirebaseDeps(config.firebase), { logger: true });
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
```

- [ ] **Step 3: Create `server/.env.example`**

```dotenv
PORT=3000
# From the service-account JSON (Project settings → Service accounts → Generate new private key)
FIREBASE_PROJECT_ID=anonymous-chat-4d8fd
FIREBASE_CLIENT_EMAIL=
# Keep on one line, in double quotes, with \n where the JSON has \n
FIREBASE_PRIVATE_KEY=""
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck -w server && npm run build -w server && ls server/dist`
Expected: exits 0; `server/dist` contains `index.js`, `app.js`, `auth.js`, `config.js`, `firebase.js`, `types.js`, `routes/`; no `*.test.js`.

- [ ] **Step 5: Smoke-check fail-fast startup**

Run (from repo root, with no `server/.env` present): `node server/dist/index.js; echo "exit=$?"`
Expected output:
```
Missing required environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
exit=1
```

- [ ] **Step 6: Commit**

```bash
git add server/src/firebase.ts server/src/index.ts server/.env.example
git commit -m "feat(server): wire firebase-admin and add entrypoint"
```

---

### Task 5: Client scaffold, Firebase init and message mapping

**Files:**
- Modify: `package.json` (add `client` workspace)
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/.env.example`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`, `client/src/vite-env.d.ts`, `client/src/types.ts`, `client/src/test/setup.ts`, `client/src/lib/firebase.ts`, `client/src/lib/messages.ts`
- Test: `client/src/lib/messages.test.ts`

**Interfaces:**
- Produces: `Message { id: string; text: string; uid: string; createdAt: Date | null }` in `client/src/types.ts`; `auth`, `db` exported from `client/src/lib/firebase.ts`; `toMessage(id: string, data: Record<string, unknown>): Message` and `MESSAGE_LIMIT = 50` from `client/src/lib/messages.ts`.

- [ ] **Step 1: Add `client` to root workspaces**

In `package.json` change `"workspaces": ["server"]` to:
```json
  "workspaces": [
    "client",
    "server"
  ],
```

- [ ] **Step 2: Create `client/package.json`**

```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Install client dependencies**

Run:
```bash
npm install -w client react react-dom firebase
npm install -D -w client typescript vite @vitejs/plugin-react @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
```
Expected: no errors.

- [ ] **Step 4: Create `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `client/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 6: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Anonymous Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create entry files**

`client/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`client/src/App.tsx` (placeholder, replaced in Task 9):
```tsx
export function App() {
  return <h1>Anonymous Chat</h1>;
}
```

`client/src/index.css` (placeholder, replaced in Task 9):
```css
body {
  margin: 0;
  background: #0b0d1f;
  color: #e8e6f5;
  font-family: system-ui, sans-serif;
}
```

`client/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`client/src/types.ts`:
```ts
export interface Message {
  id: string;
  text: string;
  uid: string;
  createdAt: Date | null;
}
```

`client/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

`client/src/lib/firebase.ts`:
```ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
```

`client/.env.example`:
```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=anonymous-chat-4d8fd.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=anonymous-chat-4d8fd
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 8: Write the failing test `client/src/lib/messages.test.ts`**

```ts
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
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./messages`.

- [ ] **Step 10: Create `client/src/lib/messages.ts`**

```ts
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
```

- [ ] **Step 11: Run tests, typecheck and build**

Run: `npm install && npm test -w client && npm run build -w client`
Expected: 2 tests PASS; build produces `client/dist/index.html`.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json client
git commit -m "feat(client): scaffold Vite React app with Firebase init"
```

---

### Task 6: Client API — `sendMessage`

**Files:**
- Create: `client/src/lib/api.ts`
- Test: `client/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `auth` from `client/src/lib/firebase.ts` (Task 5).
- Produces: `sendMessage(text: string): Promise<void>` — throws `Error` with the server's `error` string, or `Request failed (<status>)`, or `Not signed in`.

- [ ] **Step 1: Write the failing test `client/src/lib/api.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Create `client/src/lib/api.ts`**

```ts
import { auth } from './firebase';

export async function sendMessage(text: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const token = await user.getIdToken();
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts client/src/lib/api.test.ts
git commit -m "feat(client): add sendMessage API call with ID token"
```

---

### Task 7: Message display components

**Files:**
- Create: `client/src/components/MessageItem.tsx`, `client/src/components/MessageList.tsx`, `client/src/components/UserIdFooter.tsx`
- Test: `client/src/components/MessageItem.test.tsx`

**Interfaces:**
- Consumes: `Message` (Task 5).
- Produces: `MessageItem({ message, currentUid })`, `MessageList({ messages, currentUid })`, `UserIdFooter({ uid })`. CSS class names used by Task 9: `message-list`, `message-list__empty`, `message`, `message--own`, `message__meta`, `message__author`, `message__time`, `message__text`, `user-id`.

- [ ] **Step 1: Write the failing test `client/src/components/MessageItem.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { MessageItem } from './MessageItem';

const base: Message = {
  id: 'm1',
  text: 'hello there',
  uid: 'author-uid-123',
  createdAt: new Date('2026-09-23T10:15:00'),
};

describe('MessageItem', () => {
  it('labels own messages as "You" instead of the uid', () => {
    render(<MessageItem message={base} currentUid="author-uid-123" />);

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('author-uid-123')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass('message--own');
  });

  it("shows the author's uid for other people's messages", () => {
    render(<MessageItem message={base} currentUid="someone-else" />);

    expect(screen.getByText('author-uid-123')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).not.toHaveClass('message--own');
  });

  it('renders the text and time', () => {
    const { container } = render(<MessageItem message={base} currentUid="x" />);

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', base.createdAt!.toISOString());
  });

  it('renders without a time when createdAt is null', () => {
    const { container } = render(<MessageItem message={{ ...base, createdAt: null }} currentUid="x" />);

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./MessageItem`.

- [ ] **Step 3: Create `client/src/components/MessageItem.tsx`**

```tsx
import type { Message } from '../types';

interface MessageItemProps {
  message: Message;
  currentUid: string;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageItem({ message, currentUid }: MessageItemProps) {
  const isOwn = message.uid === currentUid;

  return (
    <li className={isOwn ? 'message message--own' : 'message'}>
      <div className="message__meta">
        <span className="message__author" title={message.uid}>
          {isOwn ? 'You' : message.uid}
        </span>
        {message.createdAt && (
          <time className="message__time" dateTime={message.createdAt.toISOString()}>
            {formatTime(message.createdAt)}
          </time>
        )}
      </div>
      <p className="message__text">{message.text}</p>
    </li>
  );
}
```

- [ ] **Step 4: Create `client/src/components/MessageList.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  currentUid: string;
}

export function MessageList({ messages, currentUid }: MessageListProps) {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // scrollIntoView is missing in jsdom, hence the optional call
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return <p className="message-list__empty">No messages yet. Say hi!</p>;
  }

  return (
    <ul className="message-list">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} currentUid={currentUid} />
      ))}
      <li ref={endRef} aria-hidden="true" />
    </ul>
  );
}
```

- [ ] **Step 5: Create `client/src/components/UserIdFooter.tsx`**

```tsx
export function UserIdFooter({ uid }: { uid: string }) {
  return (
    <footer className="user-id">
      Your ID: <code>{uid}</code>
    </footer>
  );
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/components
git commit -m "feat(client): add message list, item and user id footer"
```

---

### Task 8: MessageInput

**Files:**
- Create: `client/src/components/MessageInput.tsx`
- Test: `client/src/components/MessageInput.test.tsx`

**Interfaces:**
- Produces: `MessageInput({ onSend }: { onSend: (text: string) => Promise<void> })`. Calls `onSend` with trimmed text. CSS classes: `message-input`, `message-input__counter`, `message-input__error`.

- [ ] **Step 1: Write the failing test `client/src/components/MessageInput.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageInput } from './MessageInput';

function setup(onSend = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<MessageInput onSend={onSend} />);
  return {
    user,
    onSend,
    input: screen.getByRole('textbox', { name: 'Message' }),
    button: screen.getByRole('button', { name: 'Send' }),
  };
}

describe('MessageInput', () => {
  it('sends trimmed text on Enter and clears the input', async () => {
    const { user, onSend, input } = setup();

    await user.type(input, '  hello  {Enter}');

    expect(onSend).toHaveBeenCalledWith('hello');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not send empty or whitespace-only text', async () => {
    const { user, onSend, input, button } = setup();

    expect(button).toBeDisabled();
    await user.type(input, '   {Enter}');

    expect(button).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the text and shows the error when sending fails', async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('Server said no'));
    const { user, input } = setup(onSend);

    await user.type(input, 'hello{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
    expect(input).toHaveValue('hello');
  });

  it('sends only once on rapid double submit', async () => {
    const onSend = vi.fn<(text: string) => Promise<void>>(() => new Promise(() => {}));
    const { user, input, button } = setup(onSend);

    await user.type(input, 'hi{Enter}{Enter}');
    await user.click(button);

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('shows a character counter and limits input to 500 characters', async () => {
    const { user, input } = setup();

    await user.type(input, 'hello');

    expect(screen.getByText('5/500')).toBeInTheDocument();
    expect(input).toHaveAttribute('maxLength', '500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./MessageInput`.

- [ ] **Step 3: Create `client/src/components/MessageInput.tsx`**

```tsx
import { useRef, useState, type FormEvent } from 'react';

const MAX_LENGTH = 500;

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates are async; the ref blocks a second submit fired before re-render.
  const sendingRef = useRef(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !sending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        aria-label="Message"
        placeholder="Type a message…"
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        autoComplete="off"
      />
      <span className="message-input__counter">
        {text.length}/{MAX_LENGTH}
      </span>
      <button type="submit" disabled={!canSend}>
        Send
      </button>
      {error && (
        <p className="message-input__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MessageInput.tsx client/src/components/MessageInput.test.tsx
git commit -m "feat(client): add message input with validation and error state"
```

---

### Task 9: Hooks, ChatRoom, App and dark theme styling

**Files:**
- Create: `client/src/hooks/useAnonymousAuth.ts`, `client/src/hooks/useMessages.ts`, `client/src/components/ChatRoom.tsx`
- Modify: `client/src/App.tsx`, `client/src/index.css` (full replacements)
- Test: `client/src/components/ChatRoom.test.tsx`

**Interfaces:**
- Consumes: `auth`, `db` (Task 5), `toMessage`, `MESSAGE_LIMIT` (Task 5), `sendMessage` (Task 6), `MessageList`, `UserIdFooter` (Task 7), `MessageInput` (Task 8).
- Produces: `useAnonymousAuth(): { user: User | null; loading: boolean; error: Error | null; retry: () => void }`; `useMessages(enabled: boolean): { messages: Message[]; error: Error | null }`; `ChatRoom()`.

- [ ] **Step 1: Write the failing test `client/src/components/ChatRoom.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAnonymousAuth: vi.fn(),
  useMessages: vi.fn(),
}));

vi.mock('../hooks/useAnonymousAuth', () => ({ useAnonymousAuth: mocks.useAnonymousAuth }));
vi.mock('../hooks/useMessages', () => ({ useMessages: mocks.useMessages }));
vi.mock('../lib/api', () => ({ sendMessage: vi.fn() }));

import { ChatRoom } from './ChatRoom';

const retry = vi.fn();

function authState(overrides: Record<string, unknown> = {}) {
  return { user: null, loading: false, error: null, retry, ...overrides };
}

describe('ChatRoom', () => {
  beforeEach(() => {
    retry.mockReset();
    mocks.useMessages.mockReturnValue({ messages: [], error: null });
  });

  it('shows "Connecting…" while signing in', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ loading: true }));

    render(<ChatRoom />);

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(mocks.useMessages).toHaveBeenCalledWith(false);
  });

  it('shows a retry screen when sign-in fails', async () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ error: new Error('boom') }));

    render(<ChatRoom />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText("Couldn't connect")).toBeInTheDocument();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders messages, "You" label and own id when signed in', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ user: { uid: 'me-uid' } }));
    mocks.useMessages.mockReturnValue({
      messages: [
        { id: '1', text: 'from me', uid: 'me-uid', createdAt: null },
        { id: '2', text: 'from other', uid: 'other-uid', createdAt: null },
      ],
      error: null,
    });

    render(<ChatRoom />);

    expect(mocks.useMessages).toHaveBeenCalledWith(true);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('other-uid')).toBeInTheDocument();
    expect(screen.getByText(/Your ID:/)).toHaveTextContent('Your ID: me-uid');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows a banner when the messages subscription fails', () => {
    mocks.useAnonymousAuth.mockReturnValue(authState({ user: { uid: 'me-uid' } }));
    mocks.useMessages.mockReturnValue({ messages: [], error: new Error('permission-denied') });

    render(<ChatRoom />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load messages");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./ChatRoom`.

- [ ] **Step 3: Create `client/src/hooks/useAnonymousAuth.ts`**

```ts
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '../lib/firebase';

export interface AnonymousAuthState {
  user: User | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

export function useAnonymousAuth(): AnonymousAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Firebase restores a persisted session first; only sign in when there is none.
    return onAuthStateChanged(auth, (current) => {
      if (current) {
        setUser(current);
        setError(null);
        setLoading(false);
        return;
      }
      setUser(null);
      signInAnonymously(auth).catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Anonymous sign-in failed'));
        setLoading(false);
      });
    });
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  return { user, loading, error, retry };
}
```

- [ ] **Step 4: Create `client/src/hooks/useMessages.ts`**

```ts
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { MESSAGE_LIMIT, toMessage } from '../lib/messages';
import type { Message } from '../types';

export function useMessages(enabled: boolean): { messages: Message[]; error: Error | null } {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Security Rules require auth, so subscribe only after sign-in.
    if (!enabled) return;

    const latest = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(MESSAGE_LIMIT));
    return onSnapshot(
      latest,
      (snapshot) => {
        // Newest-first from the query; show oldest at the top.
        setMessages(snapshot.docs.map((doc) => toMessage(doc.id, doc.data())).reverse());
        setError(null);
      },
      (err) => setError(err),
    );
  }, [enabled]);

  return { messages, error };
}
```

- [ ] **Step 5: Create `client/src/components/ChatRoom.tsx`**

```tsx
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useMessages } from '../hooks/useMessages';
import { sendMessage } from '../lib/api';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { UserIdFooter } from './UserIdFooter';

export function ChatRoom() {
  const { user, loading, error, retry } = useAnonymousAuth();
  const { messages, error: messagesError } = useMessages(Boolean(user));

  if (loading) {
    return <p className="status">Connecting…</p>;
  }

  if (error || !user) {
    return (
      <div className="status">
        <p>Couldn't connect</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <main className="chat">
      <header className="chat__header">
        <h1>Anonymous Chat</h1>
      </header>
      {messagesError && (
        <div className="banner" role="alert">
          Couldn't load messages
        </div>
      )}
      <MessageList messages={messages} currentUid={user.uid} />
      <MessageInput onSend={sendMessage} />
      <UserIdFooter uid={user.uid} />
    </main>
  );
}
```

- [ ] **Step 6: Replace `client/src/App.tsx`**

```tsx
import { ChatRoom } from './components/ChatRoom';

export function App() {
  return <ChatRoom />;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 8: Style with the `frontend-design` skill**

Invoke the `frontend-design` skill (user request) and restyle `client/src/index.css` with these constraints:
- Dark theme only; background a deep navy → purple gradient; purple/indigo accents.
- Restrained: no glassmorphism overload, no animations beyond subtle transitions, no web fonts required.
- Keep every class name listed in Task 7, Task 8 and this task's `ChatRoom` (`status`, `chat`, `chat__header`, `banner`) — do not change JSX structure or copy, tests depend on them.
- Long unbroken text must wrap (`overflow-wrap: anywhere`); layout must work at 360px width.

Starting point to refine (a complete, working stylesheet):

```css
:root {
  color-scheme: dark;
  --bg-from: #0a0e27;
  --bg-to: #2a1052;
  --surface: rgba(17, 20, 48, 0.85);
  --border: rgba(139, 124, 246, 0.18);
  --text: #e8e6f5;
  --muted: #9a97b8;
  --accent-from: #6d4aff;
  --accent-to: #3b5bdb;
  --bubble: #1c2046;
  --danger: #f06277;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100dvh;
  color: var(--text);
  background: linear-gradient(160deg, var(--bg-from) 0%, #151a45 50%, var(--bg-to) 100%) fixed;
}

.chat {
  max-width: 760px;
  height: 100dvh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-inline: 1px solid var(--border);
}

.chat__header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.chat__header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.banner {
  padding: 8px 20px;
  background: rgba(240, 98, 119, 0.15);
  color: var(--danger);
  font-size: 14px;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 20px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-list__empty {
  flex: 1;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--muted);
}

.message {
  max-width: 75%;
  align-self: flex-start;
  padding: 8px 12px;
  border-radius: 14px 14px 14px 4px;
  background: var(--bubble);
  border: 1px solid var(--border);
}

.message--own {
  align-self: flex-end;
  border: 0;
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, var(--accent-from), var(--accent-to));
}

.message__meta {
  display: flex;
  gap: 8px;
  margin-bottom: 2px;
  font-size: 12px;
  color: var(--muted);
}

.message--own .message__meta {
  color: rgba(255, 255, 255, 0.75);
}

.message__author {
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message__text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}

.message-input input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(10, 14, 39, 0.6);
  color: inherit;
  font: inherit;
}

.message-input input:focus {
  outline: 2px solid var(--accent-from);
  outline-offset: 1px;
}

.message-input button,
.status button {
  padding: 10px 18px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent-from), var(--accent-to));
  color: #fff;
  font: inherit;
  cursor: pointer;
  transition: opacity 0.15s;
}

.message-input button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.message-input__counter {
  font-size: 12px;
  color: var(--muted);
}

.message-input__error {
  flex-basis: 100%;
  margin: 0;
  color: var(--danger);
  font-size: 14px;
}

.user-id {
  padding: 8px 20px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.status {
  min-height: 100dvh;
  margin: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--muted);
}
```

- [ ] **Step 9: Run tests and build**

Run: `npm test -w client && npm run build -w client`
Expected: all PASS; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add client/src
git commit -m "feat(client): add chat room with anonymous auth, realtime messages and dark theme"
```

---

### Task 10: Firestore rules, Docker and README

**Files:**
- Create: `firestore.rules`, `firebase.json`, `.firebaserc`
- Create: `server/Dockerfile`, `client/Dockerfile`, `client/nginx.conf`, `.dockerignore`, `docker-compose.yml`, `.env.example`
- Create: `README.md`

**Interfaces:**
- Consumes: `npm run build -w server` → `server/dist/index.js`; `npm run build -w client` → `client/dist`; `GET /api/health`.

- [ ] **Step 1: Create Firestore rules and CLI config**

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /messages/{id} {
      allow read: if request.auth != null;
      allow write: if false;   // only the backend writes, via firebase-admin
    }
  }
}
```

`firebase.json`:
```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

`.firebaserc`:
```json
{
  "projects": {
    "default": "anonymous-chat-4d8fd"
  }
}
```

- [ ] **Step 2: Create `.dockerignore`** (build context is the repo root for both images)

```gitignore
**/node_modules
**/dist
**/.env
**/.env.*
!**/.env.example
**/*-firebase-adminsdk-*.json
.git
docs
```

- [ ] **Step 3: Create `server/Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server
COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/src server/src
RUN npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server --omit=dev
COPY --from=build /app/server/dist server/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
```

- [ ] **Step 4: Create `client/nginx.conf` and `client/Dockerfile`**

`client/nginx.conf`:
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://server:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

`client/Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w client
COPY client client
# Vite inlines VITE_* at build time; these are public web config values, not secrets.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
RUN npm run build -w client

FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
```

- [ ] **Step 5: Create `docker-compose.yml` and root `.env.example`**

`docker-compose.yml`:
```yaml
services:
  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    env_file: server/.env
    environment:
      PORT: "3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 5s
      timeout: 3s
      retries: 10

  client:
    build:
      context: .
      dockerfile: client/Dockerfile
      args:
        VITE_FIREBASE_API_KEY: ${VITE_FIREBASE_API_KEY}
        VITE_FIREBASE_AUTH_DOMAIN: ${VITE_FIREBASE_AUTH_DOMAIN}
        VITE_FIREBASE_PROJECT_ID: ${VITE_FIREBASE_PROJECT_ID}
        VITE_FIREBASE_APP_ID: ${VITE_FIREBASE_APP_ID}
    ports:
      - "8080:80"
    depends_on:
      server:
        condition: service_healthy
```

`.env.example`:
```dotenv
# Used by docker compose as build args for the client image
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=anonymous-chat-4d8fd.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=anonymous-chat-4d8fd
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 6: Build both images**

Run: `cp -n server/.env.example server/.env; cp -n .env.example .env; docker compose build`
Expected: both images build successfully (the copied example env files are enough to build; real values are filled in Task 11). If `server/.env` or `.env` already exist, `cp -n` leaves them untouched.

- [ ] **Step 7: Create `README.md`**

````markdown
# Anonymous Chat

A single-room anonymous chat. React + TypeScript client, Fastify + TypeScript server, Firebase Anonymous Auth and Cloud Firestore.

## Architecture

```
React ──signInAnonymously──▶ Firebase Auth ──▶ uid + ID token
  │
  ├─ POST /api/messages { text }  + Authorization: Bearer <ID token>
  │        ▼
  │   Fastify: verifyIdToken → uid → validation → Firestore add
  │                                      ▼
  │                               Firestore: messages
  └◀──── onSnapshot (realtime) ─────────┘
```

- **Writes go only through the backend.** The server verifies the Firebase ID token, takes `uid` from the token (never from the body), trims and validates text (1–500 chars) and sets `createdAt` with a server timestamp.
- **Reads are realtime straight from Firestore** (`onSnapshot`, latest 50 messages). Security Rules allow reads for signed-in users and deny all client writes.

## Project layout

```
client/   React + Vite
server/   Fastify + firebase-admin
firestore.rules
docker-compose.yml
```

## Firebase setup

1. Create a project at https://console.firebase.google.com.
2. **Authentication → Sign-in method → Anonymous → Enable.**
3. **Firestore Database → Create database** (Standard edition, production mode, any location).
4. **Project settings → General → Your apps → Web app** — copy `apiKey`, `authDomain`, `projectId`, `appId`.
5. **Project settings → Service accounts → Generate new private key** — downloads a JSON file. Keep it secret; never commit it.
6. Publish the rules: paste `firestore.rules` into **Firestore → Rules → Publish**, or run
   `npx firebase-tools login && npx firebase-tools deploy --only firestore:rules`.

## Environment

| File | Used by | Keys |
|---|---|---|
| `client/.env.local` | `npm run dev` | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` |
| `.env` (root) | Docker build args | same as above |
| `server/.env` | server (local and Docker) | `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |

Copy each `*.env.example` and fill it in. For `FIREBASE_PRIVATE_KEY`, copy `private_key` from the service-account JSON **as is** — one line, wrapped in double quotes, with the `\n` sequences kept. The server turns `\n` into real newlines.

The `VITE_*` values are public web config (they end up in the JS bundle anyway); the service-account values are secrets.

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev
```

Client: http://localhost:5173 (Vite proxies `/api` to the server on :3000).

## Run with Docker

```bash
docker compose up --build
```

Open http://localhost:8080. nginx serves the client and proxies `/api` to the server; only port 8080 is exposed.

## Tests

```bash
npm test
```

- **Server** (Vitest + `app.inject`): auth (401), validation (400, including no type coercion and no silently stripped fields), success (uid from token, trimmed text), storage failure (500 without details). Firebase is replaced by fakes injected into `buildApp()`.
- **Client** (Vitest + React Testing Library): "You" label, message input behaviour (trim, empty, errors, double submit), chat room states, API client.

## API

`POST /api/messages` — header `Authorization: Bearer <Firebase ID token>`, body `{ "text": string }` → `201 { "id": string }`.
Errors: `{ "error": string }` with `401`, `400` or `500`.

`GET /api/health` → `200 { "ok": true }`.
````

- [ ] **Step 8: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: server and client tests all PASS; both builds succeed.

- [ ] **Step 9: Commit**

```bash
git add firestore.rules firebase.json .firebaserc .dockerignore docker-compose.yml .env.example server/Dockerfile client/Dockerfile client/nginx.conf README.md
git commit -m "feat: add Firestore rules, Docker setup and README"
```

---

### Task 11: Real credentials and end-to-end smoke test (needs the user)

**Files:** none committed (only gitignored env files).

This task needs the user for two things: the service-account JSON and publishing the rules.

- [ ] **Step 1: Fill client env files** (public values from the spec conversation)

Write both `client/.env.local` and root `.env` with:
```dotenv
VITE_FIREBASE_API_KEY=<apiKey from Firebase web app config>
VITE_FIREBASE_AUTH_DOMAIN=anonymous-chat-4d8fd.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=anonymous-chat-4d8fd
VITE_FIREBASE_APP_ID=<appId from Firebase web app config>
```

- [ ] **Step 2: Ask the user to fill `server/.env`**

Ask the user to put `client_email` and `private_key` from their service-account JSON into `server/.env` themselves (do not ask them to paste the key into chat). Then verify only the shape, without printing secrets:

Run: `grep -c '^FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----' server/.env; grep -c '^FIREBASE_CLIENT_EMAIL=.\+@anonymous-chat-4d8fd.iam.gserviceaccount.com' server/.env`
Expected: `1` and `1`.

- [ ] **Step 3: Ask the user to publish `firestore.rules`**

Console: Firestore → Rules → paste file contents → Publish (or `npx firebase-tools login` then `npx firebase-tools deploy --only firestore:rules`, which is interactive and must be run by the user).

- [ ] **Step 4: Local smoke test**

Run: `npm run dev` (background), then open http://localhost:5173 in two windows (one normal, one incognito → two different uids). Check:
- both show `Your ID: …` with different ids, stable across reload;
- a message sent in one window appears in both without reload; sender sees `You`, the other window sees the uid;
- sending whitespace only is impossible; a 500-char message is accepted.

- [ ] **Step 5: Docker smoke test**

Stop the dev servers, then run: `docker compose up --build -d && docker compose ps`
Expected: `server` is `healthy`, `client` is running. Open http://localhost:8080 and repeat the send/receive check. Then `docker compose down`.

- [ ] **Step 6: Final commit if anything changed**

Run: `git status`
Expected: clean (env files are ignored). If any fixes were needed during smoke tests, commit them with a descriptive message.
