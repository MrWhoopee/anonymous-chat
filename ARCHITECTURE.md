# Архітектура Anonymous Chat

Документ описує, як влаштований проєкт: які є частини, як між ними ходять дані, що робить кожен файл і чому рішення саме такі.

---

## 1. Огляд

Однокімнатний анонімний чат.

- **Клієнт** — React + TypeScript (Vite).
- **Сервер** — Fastify + TypeScript.
- **Авторизація** — Firebase Anonymous Auth: користувач нічого не вводить, Firebase видає йому постійний `uid`.
- **Сховище і realtime** — Cloud Firestore.

Головний принцип: **запис — тільки через бекенд, читання — напряму з Firestore.**

```
┌────────────┐  signInAnonymously   ┌────────────────┐
│   React    │ ───────────────────▶ │ Firebase Auth  │
│  (client)  │ ◀─── uid + ID token ─┘                │
│            │                      └────────────────┘
│            │  POST /api/messages
│            │  Authorization: Bearer <ID token>
│            │ ───────────────────▶ ┌────────────────┐
│            │                      │    Fastify     │
│            │                      │   (server)     │
│            │                      │ verifyIdToken  │
│            │                      │ валідація      │
│            │                      │ firestore.add  │
│            │                      └───────┬────────┘
│            │                              ▼
│            │  onSnapshot (realtime) ┌────────────────┐
│            │ ◀───────────────────── │   Firestore    │
└────────────┘                        │  "messages"    │
                                      └────────────────┘
```

**Чому так:**
- Бекенд — єдине місце, де можна **гарантувати**, що автор повідомлення справжній: `uid` береться з перевіреного токена, а не з тіла запиту, а `createdAt` ставить сервер.
- Realtime дає Firestore з коробки (`onSnapshot`), тому власний WebSocket не потрібен.
- Firestore Security Rules забороняють клієнту писати напряму, тому обійти бекенд неможливо.

---

## 2. Структура репозиторію

```
anonymous-chat/
├─ package.json            npm workspaces (client, server) + загальні скрипти
├─ firestore.rules         правила безпеки Firestore
├─ firebase.json           вказує Firebase CLI на firestore.rules
├─ .firebaserc             ID проєкту за замовчуванням
├─ docker-compose.yml      запуск server + client (nginx)
├─ .dockerignore           що не потрапляє в Docker-образи (секрети, node_modules)
├─ .env.example            VITE_* для збірки клієнта в Docker
├─ README.md               як налаштувати й запустити
├─ ARCHITECTURE.md         цей документ
│
├─ server/
│  ├─ package.json, tsconfig.json, tsconfig.build.json
│  ├─ Dockerfile
│  ├─ .env.example
│  └─ src/
│     ├─ index.ts              точка входу
│     ├─ app.ts                створення Fastify-застосунку
│     ├─ config.ts             читання й перевірка env
│     ├─ firebase.ts           підключення firebase-admin
│     ├─ auth.ts               перевірка Bearer-токена
│     ├─ types.ts              інтерфейси залежностей
│     ├─ routes/messages.ts    POST /api/messages
│     ├─ app.test.ts           тести API
│     └─ config.test.ts        тести конфігу
│
└─ client/
   ├─ package.json, tsconfig.json, vite.config.ts, index.html
   ├─ Dockerfile, nginx.conf
   ├─ .env.example
   └─ src/
      ├─ main.tsx, App.tsx, index.css, types.ts, vite-env.d.ts
      ├─ lib/        firebase.ts, api.ts, messages.ts
      ├─ hooks/      useAnonymousAuth.ts, useMessages.ts
      ├─ components/ ChatRoom, MessageList, MessageItem, MessageInput, UserIdFooter
      └─ test/setup.ts
```

**npm workspaces:** одна команда `npm install` у корені ставить залежності обох частин. `npm test`, `npm run build` і `npm run dev` запускають відповідні скрипти в обох workspace.

---

## 3. Модель даних

Колекція Firestore `messages`, ID документів генеруються автоматично.

| Поле        | Тип       | Хто ставить | Звідки |
|-------------|-----------|-------------|--------|
| `text`      | string    | сервер      | тіло запиту, після `trim()`, 1–500 символів |
| `uid`       | string    | сервер      | з перевіреного ID-токена |
| `createdAt` | timestamp | сервер      | `FieldValue.serverTimestamp()` — час сервера Google, не клієнта |

Клієнт бачить повідомлення як тип `Message` (`client/src/types.ts`):

```ts
interface Message { id: string; text: string; uid: string; createdAt: Date | null }
```

---

## 4. Сервер (`server/`)

### 4.1 Життєвий цикл запиту `POST /api/messages`

```
запит
  │
  ▼ onRequest: auth hook (auth.ts)
  │   немає/кривий заголовок Authorization ──▶ 401
  │   verifyIdToken кинув помилку          ──▶ 401
  │   ок → request.user = { uid }
  ▼ парсинг JSON
  │   зламаний JSON                        ──▶ 400 (через error handler)
  ▼ валідація JSON Schema
  │   немає text / text не рядок / зайві поля ──▶ 400
  ▼ handler (routes/messages.ts)
  │   text.trim() порожній або > 500       ──▶ 400
  │   messages.add({ text, uid })
  │     Firestore впав                     ──▶ 500 { error: "Internal Server Error" }
  ▼
201 { id }
```

Авторизація стоїть у хуку **`onRequest`**, тобто **до** парсингу й валідації тіла. Неавторизований запит завжди отримує 401, навіть якщо тіло некоректне, і сервер навіть не парсить тіло від анонімного відправника.

### 4.2 Файли

**`src/types.ts` — контракти залежностей**

```ts
interface TokenVerifier { verifyIdToken(token: string): Promise<{ uid: string }> }
interface MessageStore  { add(message: NewMessage): Promise<{ id: string }> }
interface AppDeps       { auth: TokenVerifier; messages: MessageStore }
```

Застосунок залежить від цих маленьких інтерфейсів, а не від firebase-admin напряму (dependency injection). Через це в тестах замість Firebase можна передати `vi.fn()`, а справжній SDK використовується лише у `firebase.ts`.

**`src/app.ts` — `buildApp(deps, options)`**

Створює Fastify-інстанс, але **не запускає** його (`listen` викликається в `index.ts`). Тести через `app.inject()` проганяють запити без відкриття порту.

Що тут налаштовано:
- **Ajv з `removeAdditional: false, coerceTypes: false`.** За замовчуванням Fastify *мовчки видаляє* зайві поля і *перетворює типи*: `text: 123` став би `"123"`. Для API чату це небезпечно: підставлений `{ uid: "чужий" }` просто зник би без помилки. Тепер обидва випадки повертають 400.
- **`decorateRequest('user', null)`** оголошує поле `request.user` (Fastify вимагає оголошувати поля заздалегідь для продуктивності).
- **`setErrorHandler`** зводить усі помилки до формату `{ error: string }`. Для 4xx повертає повідомлення помилки. Для 5xx логує деталі на сервері, а клієнту віддає тільки `"Internal Server Error"`, щоб внутрішні помилки не витікали назовні.
- **`GET /api/health`** повертає `{ ok: true }`, його використовує healthcheck у Docker.

**`src/auth.ts` — `createAuthHook(verifier)`**

- Перевіряє заголовок регуляркою `^Bearer (\S+)$`. Не пропускає `bearer x` (малими літерами), `Bearer ` з порожнім токеном і `Basic ...`.
- Викликає `verifier.verifyIdToken(token)`. firebase-admin перевіряє підпис JWT публічними ключами Google, термін дії і `aud` (ID проєкту).
- Кладе `{ uid }` у `request.user`.
- Містить `declare module 'fastify'` для типізації `request.user`.

**`src/routes/messages.ts` — `POST /api/messages`**

- JSON Schema: `{ text: string }`, `required`, `additionalProperties: false`.
- Перевірка довжини **після `trim()`** робиться в коді, бо JSON Schema не вміє обрізати пробіли.
- `uid` береться **тільки** з `request.user`, тіло запиту для цього не використовується.
- Константа `MAX_MESSAGE_LENGTH = 500`.

**`src/config.ts` — `loadConfig(env)`**

- Перевіряє `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Якщо чогось бракує, падає **на старті** зі списком відсутніх змінних, а не на першому запиті (fail fast).
- `PORT` за замовчуванням 3000, некоректний порт дає помилку.
- `privateKey.replace(/\\n/g, '\n')`: у `.env` ключ записаний одним рядком з літеральними `\n`, а `cert()` очікує справжні переноси рядків.
- Приймає `env` параметром, тому тестується без підміни `process.env`.

**`src/firebase.ts` — `createFirebaseDeps(config)`**

Єдине місце, яке торкається справжнього SDK:
- `initializeApp({ credential: cert(...) })` підключає сервіс-акаунт;
- `auth: getAuth(app)` підходить під `TokenVerifier`;
- `messages.add` виконує `db.collection('messages').add({ ...message, createdAt: FieldValue.serverTimestamp() })`.

Firebase Admin SDK **ігнорує Security Rules**: сервіс-акаунт має повний доступ. Саме тому rules можуть забороняти запис усім, а бекенд однаково пише.

**`src/index.ts` — точка входу**

1. `process.loadEnvFile()` читає `server/.env`, якщо він є. У Docker файлу немає, змінні приходять через `env_file`.
2. `loadConfig()` → `createFirebaseDeps()` → `buildApp()` → `listen({ host: '0.0.0.0' })`. Адреса `0.0.0.0` потрібна, щоб сервер був доступний з інших контейнерів.
3. Будь-яка помилка старту виводиться коротким повідомленням і дає `exit(1)`.

### 4.3 Збірка

- `tsconfig.json`: `module: NodeNext`, `strict`, `noEmit`. Використовується для typecheck разом із тестами.
- `tsconfig.build.json`: емітить JS у `dist/` і виключає `*.test.ts`.
- Проєкт на ESM (`"type": "module"`), тому імпорти пишуться з `.js` (`./app.js`), як того вимагає NodeNext.
- `npm run dev` запускає `tsx watch` (TypeScript без компіляції, з перезапуском при змінах).

---

## 5. Клієнт (`client/`)

### 5.1 Дерево компонентів і потік даних

```
App
└─ ChatRoom
   ├─ useAnonymousAuth()  ──▶ { user, loading, error, retry }
   ├─ useMessages(!!user) ──▶ { messages, error }
   │
   ├─ loading          → "Connecting…"
   ├─ error / no user  → "Couldn't connect" + [Retry]
   └─ готово:
      ├─ header "Anonymous Chat"
      ├─ banner "Couldn't load messages"   (якщо помилка підписки)
      ├─ MessageList (messages, currentUid)
      │  └─ MessageItem × N   → "You" або uid автора
      ├─ MessageInput (onSend = sendMessage)
      └─ UserIdFooter (uid)   → "Your ID: <uid>"
```

Відправка повідомлення:
```
MessageInput ─▶ sendMessage(text) ─▶ POST /api/messages ─▶ сервер ─▶ Firestore
                                                                        │
MessageList ◀── useMessages ◀── onSnapshot ◀────────────────────────────┘
```
Клієнт **не додає** повідомлення в стейт сам: воно з'являється, лише коли прийде з Firestore. Так немає дублікатів, а на екрані завжди видно реальний стан бази.

### 5.2 Файли

**`src/lib/firebase.ts`** — `initializeApp` з чотирма `VITE_*` змінними, експортує `auth` і `db`. Analytics не підключено.

**`src/lib/api.ts` — `sendMessage(text)`**
- Бере `auth.currentUser`; якщо користувача немає, кидає `Not signed in`.
- `getIdToken()` сам оновлює прострочений токен (він живе близько години).
- `fetch('/api/messages')` іде за **відносним** шляхом: у dev запит проксіює Vite, у Docker — nginx, тож CORS не потрібен.
- При помилці кидає `Error` з полем `error` із відповіді сервера, а якщо тіло не JSON — `Request failed (<status>)`.

**`src/lib/messages.ts`**
- `toMessage(id, data)` перетворює документ Firestore на `Message`. `createdAt` (Firestore `Timestamp`) стає `Date`, а якщо його немає — `null`.
- `MESSAGE_LIMIT = 50`.

**`src/hooks/useAnonymousAuth.ts`**
- Підписується на `onAuthStateChanged`. Firebase спочатку відновлює збережену сесію з IndexedDB. Якщо користувача немає, викликається `signInAnonymously`, тому **той самий `uid` зберігається між перезавантаженнями**.
- `retry()` збільшує лічильник `attempt`, і ефект перепідписується.
- Під React StrictMode ефект у dev монтується двічі, але перша підписка скасовується раніше, ніж Firebase викличе колбек, тому зайвий анонімний користувач не створюється.

**`src/hooks/useMessages.ts`**
- `query(collection('messages'), orderBy('createdAt','desc'), limit(50))` отримує 50 **найновіших**, а `.reverse()` показує їх від старих до нових.
- Підписується лише коли `enabled === true` (є користувач), бо rules вимагають авторизації.
- Відписується при unmount, бо `onSnapshot` повертає функцію відписки.
- Для такого запиту достатньо автоматичного індексу по одному полю, композитний індекс не потрібен.

**`src/components/ChatRoom.tsx`** — збирає все разом і відповідає за три стани: підключення, помилка, чат.

**`src/components/MessageList.tsx`** — список плюс автоскрол до низу через невидимий `<li ref>` і `scrollIntoView`. Якщо повідомлень немає, показує «No messages yet. Say hi!».

**`src/components/MessageItem.tsx`**
- `isOwn = message.uid === currentUid`: для своїх повідомлень показує **«You»** і клас `message--own` (праворуч, градієнт), для чужих — `uid`, повний `uid` є в `title`.
- Час виводиться через `toLocaleTimeString` у `<time dateTime=…>`. Якщо `createdAt` дорівнює `null`, часу немає, але компонент не падає.
- Текст React рендерить як текст, не як HTML, тож XSS неможливий.

**`src/components/MessageInput.tsx`**
- Керований `<input>` з `maxLength=500`, лічильником `N/500`, відправкою по Enter (нативний submit форми).
- Кнопка вимкнена, якщо після trim текст порожній або йде відправка.
- **Захист від подвійної відправки:** крім стану `sending`, є `sendingRef`. Стан оновлюється асинхронно, тож два швидкі Enter могли б проскочити до ререндера, а ref блокує другий миттєво.
- При успіху поле очищується. При помилці текст **залишається**, а під полем з'являється повідомлення (`role="alert"`).

**`src/components/UserIdFooter.tsx`** — «Your ID: `<uid>`» внизу чату.

**`src/index.css`** — лише темна тема: градієнт темно-синій → фіолетовий, акцентний колір Iris `#8f73ff`. Є видимий `:focus-visible`, підтримка `prefers-reduced-motion` і адаптація під ширину до 480px.

### 5.3 Конфігурація
- `vite.config.ts`: плагін React, проксі `/api → http://localhost:3000`, налаштування Vitest (`jsdom`, setup-файл).
- `vite-env.d.ts` типізує `import.meta.env.VITE_*`.
- Vite **вбудовує** `VITE_*` у JS під час збірки. Тому ці значення не секретні: це публічний конфіг Firebase.

---

## 6. Безпека

| Загроза | Захист |
|---|---|
| Хтось пише від імені іншого користувача | `uid` береться лише з перевіреного токена; поле `uid` у тілі дає 400 |
| Клієнт пише в Firestore напряму, оминаючи сервер | `allow write: if false` у rules (перевірено: 403) |
| Читання чату без входу | `allow read: if request.auth != null` (перевірено: 403) |
| Підроблений або прострочений токен | `verifyIdToken` перевіряє підпис, `exp` і `aud`, інакше 401 |
| Витік внутрішніх помилок | для 5xx клієнт отримує лише `"Internal Server Error"` |
| XSS через текст повідомлення | React екранує текст |
| Витік секретів | `server/.env` і JSON сервіс-акаунта є в `.gitignore` і `.dockerignore`; у контейнер вони потрапляють лише під час запуску через `env_file`, в образ не вшиваються |

`apiKey` Firebase **не є секретом**: це ідентифікатор проєкту, і він однаково опиняється в браузері. Захист забезпечують rules, Authorized domains і перевірка токена на бекенді.

**Чого немає (свідомо, поза обсягом завдання):** rate limiting, модерації, видалення чи редагування повідомлень.

---

## 7. Обробка помилок

| Де | Що відбувається | Що бачить користувач |
|---|---|---|
| Анонімний вхід не вдався | `useAnonymousAuth.error` | екран «Couldn't connect» + Retry |
| Підписка на Firestore впала | `useMessages.error` | червоний банер «Couldn't load messages» |
| Відправка: 400/401/500/мережа | `sendMessage` кидає `Error` | текст помилки під полем, введений текст зберігається |
| Сервер без env | `loadConfig` кидає помилку | сервер не стартує, у консолі видно список відсутніх змінних |

---

## 8. Тестування

Запуск: `npm test` (Vitest в обох workspace).

**Сервер** (`app.test.ts`, `config.test.ts`) — 23 тести.
- Firebase замінено фейками: `buildApp({ auth: { verifyIdToken: vi.fn() }, messages: { add: vi.fn() } })`. Мережа не потрібна.
- Запити проганяються через `app.inject()` без відкриття порту.
- Покрито: 401 (немає токена, невалідний, криві заголовки, auth перевіряється раніше за валідацію), 400 (порожній текст, пробіли, 501 символ, немає `text`, `text: 123`, зайві поля, зламаний JSON), межа в 500 символів після trim, 201 з `uid` із токена та обрізаним текстом, 500 без витоку деталей, конфіг (перетворення `\n`, порт, відсутні змінні).

**Клієнт** — 19 тестів (Vitest + React Testing Library + user-event).
- `toMessage`: `Timestamp` → `Date`, `null` або відсутній `createdAt`.
- `sendMessage`: Bearer-заголовок, помилка сервера, відповідь не JSON, користувача немає. `fetch` і модуль `firebase` замокано.
- `MessageItem`: «You» замість свого `uid`, чужий `uid`, час або його відсутність.
- `MessageInput`: trim, порожній текст, помилка зберігає текст, подвійний Enter дає лише один виклик, лічильник і `maxLength`.
- `ChatRoom`: «Connecting…», Retry, рендер повідомлень і ID, банер помилки. Хуки замокано.

Хуки `useAnonymousAuth` і `useMessages` — тонкі обгортки над Firebase SDK, тому окремих unit-тестів для них немає. Їх перевірено вручну на справжньому Firebase.

---

## 9. Інфраструктура (Docker)

```
┌──────────────── docker compose ────────────────┐
│                                                │
│  client  (nginx:alpine)            :8080 → :80 │ ◀── браузер
│    ├─ /        → статика React (SPA fallback)  │
│    └─ /api/*   → proxy_pass http://server:3000 │
│                                                │
│  server  (node:22-alpine)          :3000       │  (назовні не відкритий)
│    env_file: server/.env                       │
│    healthcheck: wget /api/health               │
└────────────────────────────────────────────────┘
```

- **Контекст збірки — корінь репо**, бо `package-lock.json` спільний для обох workspace.
- **`server/Dockerfile`** — multi-stage: у першому етапі `npm ci -w server` і `tsc`; у фінальному образі лише `npm ci -w server --omit=dev` і `dist/`, процес запускається від користувача `node`.
- **`client/Dockerfile`** — multi-stage: `vite build` з `ARG VITE_*`, потім `nginx:alpine` зі статикою.
- **`nginx.conf`** проксіює `/api/` на сервіс `server` і повертає `index.html` для SPA-маршрутів.
- **`depends_on: condition: service_healthy`**: клієнт стартує лише після того, як сервер пройшов healthcheck.
- `VITE_*` для збірки compose бере з кореневого `.env`.

---

## 10. Конфігурація оточення

| Файл | Для чого | У git |
|---|---|---|
| `client/.env.local` | `VITE_FIREBASE_*` для `npm run dev` | ні |
| `.env` (корінь) | `VITE_FIREBASE_*` як build args для Docker | ні |
| `server/.env` | `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | ні |
| `*.env.example` | шаблони з тими самими ключами | так |

---

## 11. Ключові рішення

| Рішення | Альтернатива | Чому обрано |
|---|---|---|
| Fastify | Express | вбудована валідація JSON Schema, `inject()` для тестів, TypeScript з коробки |
| Запис через бекенд, читання з Firestore | усе через бекенд + WebSocket | realtime без власної інфраструктури, бекенд лишається єдиним «вахтером» для запису |
| Firestore | Postgres (Data Connect) | є realtime-підписки, безкоштовний план, NoSQL достатньо для одної колекції |
| DI (`buildApp(deps)`) | `vi.mock('firebase-admin')` | простіші й надійніші тести, немає прив'язки до внутрішньої структури SDK |
| `onRequest` для auth | `preHandler` | 401 повертається до парсингу тіла |
| Вимкнені `removeAdditional` / `coerceTypes` | налаштування Fastify за замовчуванням | явна 400 замість мовчазних перетворень |
| Серверний `createdAt` | час клієнта | годинник клієнта може бути неправильним або підробленим |
| Vitest в обох частинах | Jest | один раннер і синтаксис, нативна підтримка ESM і TypeScript |

---

## 12. Відомі обмеження

- Текст, набраний під час відправки попереднього повідомлення, стирається після її успішного завершення.
- Після помилки `onSnapshot` підписка сама не відновлюється, допомагає лише перезавантаження сторінки.
- Автоскрол спрацьовує на кожне нове повідомлення, навіть коли користувач гортає історію.
- Показуються лише останні 50 повідомлень, пагінації немає.
- Немає rate limiting: анонімний користувач може флудити.
- Без кореневого `.env` `docker compose` збирає клієнт з порожнім конфігом, і тоді клієнт показує «Couldn't connect».
