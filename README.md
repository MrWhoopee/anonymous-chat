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
