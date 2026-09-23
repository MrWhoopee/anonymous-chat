# Anonymous Chat — Design

Date: 2026-09-23

## 1. Goal and context

Test assignment for a technical interview: a simple anonymous chat with a
single shared room.

- Frontend: React + TypeScript.
- Backend: Fastify + TypeScript. The backend exists to demonstrate backend
  work — the same app could be built on the frontend alone with the Firebase
  SDK — so all message creation goes through it.
- Authentication: Firebase Anonymous Auth.
- Storage and realtime: Cloud Firestore (Standard edition, `(default)`
  database, production mode).

Firebase project: `anonymous-chat-4d8fd`.

### Success criteria

- Opening the app signs the user in anonymously; the same `uid` survives a
  page reload.
- A user sends a message; it is written by the backend and appears in
  realtime for every open client, including the sender.
- Each message shows its author's `uid`, or the label **"You"** when the
  author is the current user.
- The current user's `uid` is shown at the bottom of the chat.
- Clients cannot write to Firestore directly; only the backend can.
- `docker compose up --build` runs the whole app; `npm test` passes.

### Out of scope

Multiple rooms, nicknames, editing/deleting messages, pagination beyond the
latest 50 messages, deployment, Firebase Emulator.

## 2. Architecture

```
React ──signInAnonymously──▶ Firebase Auth ──▶ uid + ID token
  │
  ├─ POST /api/messages { text }  + Authorization: Bearer <ID token>
  │        ▼
  │   Fastify: verifyIdToken → uid → schema validation → Firestore add
  │        (firebase-admin)
  │                                      ▼
  │                               Firestore: messages
  │                                      │
  └◀──── onSnapshot (realtime) ─────────┘
```

- **Writes** go only through the backend. The backend takes `uid` from the
  verified token (never from the request body) and sets `createdAt` with the
  server timestamp, so authorship cannot be spoofed.
- **Reads** go directly from the client to Firestore via `onSnapshot`,
  allowed for any authenticated user by Security Rules.

### Repository layout

```
anonymous-chat/
├─ client/              React + Vite + TS
├─ server/              Fastify + TS + firebase-admin
├─ firestore.rules
├─ firebase.json        points to firestore.rules (for CLI deploy)
├─ .firebaserc          default project: anonymous-chat-4d8fd
├─ docker-compose.yml
├─ .env.example
├─ README.md
└─ package.json         npm workspaces: ["client", "server"]
```

### Data model

Collection `messages`, auto-generated document IDs:

| Field       | Type      | Set by                             |
|-------------|-----------|------------------------------------|
| `text`      | string    | backend (trimmed, 1–500 chars)     |
| `uid`       | string    | backend (from verified ID token)   |
| `createdAt` | timestamp | backend (`FieldValue.serverTimestamp()`) |

## 3. Backend (`server/`)

```
server/src/
├─ firebase.ts          init firebase-admin from env; export auth, db
├─ config.ts            read + validate env; fail fast on startup if missing
├─ plugins/auth.ts      preHandler: Bearer token → verifyIdToken → request.user = { uid }
├─ routes/messages.ts   POST /api/messages
├─ app.ts               buildApp(): Fastify instance with plugins and routes (no listen)
└─ index.ts             buildApp().listen({ port: PORT, host: '0.0.0.0' })
```

`app.ts` is separate from `index.ts` so tests can call `buildApp()` and
`app.inject()` without opening a port.

### API

`POST /api/messages`
- Auth: `Authorization: Bearer <Firebase ID token>` required.
- Body schema: `{ text: string }`, `additionalProperties: false`. After
  trimming, `text` must be 1–500 characters.
- Effect: adds `{ text, uid, createdAt }` to `messages`.
- Response: `201 { id }`.

`GET /api/health` → `200 { ok: true }` (no auth; used by the Docker
healthcheck).

### Errors

All error responses use `{ error: string }`.

| Case                                                        | Status |
|-------------------------------------------------------------|--------|
| Missing `Authorization` header, malformed, invalid or expired token | 401 |
| Body fails schema, or `text` is empty/whitespace-only after trim, or > 500 chars | 400 |
| Firestore write fails                                       | 500 (details logged server-side only) |

### Configuration (`server/.env`)

`PORT` (default 3000), `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`. The private key is stored with literal `\n`
sequences, which the server converts with `.replace(/\\n/g, '\n')`.

### Tests (Vitest, `vi.mock('firebase-admin')`)

- 401 without `Authorization`; 401 when `verifyIdToken` rejects.
- 400 for empty text, whitespace-only text, 501-character text, missing
  `text`, extra fields.
- 201 for a valid request; `add` is called with the `uid` from the token
  (not from the body) and the trimmed text; response contains the new `id`.
- 500 when `add` rejects; response body does not leak error details.
- `GET /api/health` returns 200.

## 4. Frontend (`client/`)

```
client/src/
├─ lib/firebase.ts             initializeApp from VITE_* env; export auth, db
├─ lib/api.ts                  sendMessage(text): getIdToken() → POST /api/messages
├─ hooks/useAnonymousAuth.ts   onAuthStateChanged; if no user → signInAnonymously
├─ hooks/useMessages.ts        onSnapshot(query(messages, orderBy('createdAt','desc'), limit(50)))
├─ types.ts                    Message { id, text, uid, createdAt: Date | null }
├─ components/
│  ├─ ChatRoom.tsx             composes everything; loading and error states
│  ├─ MessageList.tsx          list; auto-scroll to bottom on new message
│  ├─ MessageItem.tsx          text, time, author: uid or "You"
│  ├─ MessageInput.tsx         input + button; Enter sends; 0/500 counter
│  └─ UserIdFooter.tsx         "Your ID: <uid>" at the bottom of the chat
└─ App.tsx
```

Firebase web config uses only `apiKey`, `authDomain`, `projectId`, `appId`
(no Analytics).

### Data flow

1. `useAnonymousAuth` returns `{ user, loading, error }`. While `loading`,
   show "Connecting…". Firebase persists the session, so the `uid` is stable
   across reloads.
2. `useMessages` subscribes only once `user` exists (rules require auth) and
   unsubscribes on unmount. It fetches the 50 newest messages and reverses
   them client-side so the oldest is at the top.
3. `MessageInput` calls `sendMessage`; the button is disabled while the
   request is in flight. On success the input is cleared. The message itself
   appears via `onSnapshot` — it is never added to local state manually.

### Error handling in the UI

- Auth failure → "Couldn't connect" screen with a Retry button.
- `onSnapshot` error → banner above the message list.
- Send failure (401/400/500/network) → error text under the input; the
  typed text is kept.

### Dev proxy

`vite.config.ts`: `server.proxy = { '/api': 'http://localhost:3000' }`. The
client always calls relative `/api`; Vite proxies in dev, nginx in Docker.
No CORS configuration is needed.

### Styling

Plain CSS, no UI library. Centered chat card; own messages right-aligned
with a distinct color.

### Tests (Vitest + React Testing Library, Firebase mocked)

- `MessageItem` shows "You" for the current user's `uid` and the `uid`
  otherwise.
- `MessageInput` does not send empty/whitespace text, clears after success,
  keeps text and shows an error on failure.
- `ChatRoom` shows "Connecting…" while auth is loading.

## 5. Firestore Security Rules

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

Applied either by pasting into the console (Firestore → Rules → Publish) or
with `npx firebase-tools deploy --only firestore:rules`. The single-field
`createdAt` index Firestore creates automatically covers the query; no
composite index is needed.

## 6. Docker

`docker-compose.yml`:

- **server** — `build: ./server`; multi-stage (`tsc` build → `node:22-alpine`
  with production dependencies only); `env_file: server/.env` (secrets are
  never baked into the image); healthcheck on `GET /api/health`; port 3000
  not published to the host.
- **client** — `build: ./client` with build args `VITE_FIREBASE_*` taken from
  the root `.env`; multi-stage (`vite build` → `nginx:alpine`); `nginx.conf`
  serves the SPA and proxies `/api` to `http://server:3000`; published as
  `8080:80`; `depends_on: server` with `condition: service_healthy`.

Run: `docker compose up --build`, open http://localhost:8080.

## 7. Environment files

| File                | Contents                                      | In git |
|---------------------|-----------------------------------------------|--------|
| `client/.env.local` | `VITE_FIREBASE_*` for `npm run dev`           | no     |
| `.env` (root)       | `VITE_FIREBASE_*` for Docker build args       | no     |
| `server/.env`       | `PORT`, `FIREBASE_*` service-account values   | no     |
| `*.env.example`     | same keys, empty values                       | yes    |

## 8. Root scripts

- `npm run dev` — server and client together (`concurrently`).
- `npm test` — tests in both workspaces.
- `npm run build` — build both workspaces.

## 9. README

Step-by-step Firebase setup (project, Anonymous auth, Firestore database,
service-account key), env files including the private-key `\n` pitfall,
running locally and with Docker, running tests, a short architecture
diagram.
