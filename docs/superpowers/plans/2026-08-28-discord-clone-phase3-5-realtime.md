# Discord Clone Phase 3-5 Implementation Plan: Real-Time Chat, Presence, Roles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real-time text chat (Socket.IO, JWT-authenticated handshake, message persistence + broadcast, history load), presence/typing indicators, and enforcement of the three-role permission system beyond channel creation — on top of the completed Phase 0-2 foundation (monorepo, auth, servers/channels CRUD).

**Architecture:** `apps/socket-server` gains a JWT/JWE session-cookie decoder (Auth.js v5 issues encrypted JWEs, not plain signed JWTs — `jsonwebtoken` cannot read them; `next-auth/jwt`'s `decode()` can, using the same `NEXTAUTH_SECRET`), a Socket.IO connection-auth middleware, and per-domain handler modules (channels, messages, typing, presence) registered on each connection. `apps/web` gains a message-history REST endpoint, a shared client-side socket singleton, and new UI (`ChatPanel`, member list) wired into the existing `(main)` route group. Role enforcement flows through the existing `@repo/permissions` helpers, now consumed by two new `apps/web` API routes and (for message deletion) by `apps/socket-server` directly.

**Tech Stack:** Everything from Phase 0-2, plus: `next-auth/jwt` (already added to `apps/socket-server` as a dependency swap for the unused `jsonwebtoken`) for session decoding, `socket.io-client` (new, in `apps/web`) for the browser connection.

## Global Constraints

(Carried over from the Phase 0-2 plan, still binding, plus new ones for this phase — exact text below.)

- Real-time transport is Socket.IO, run as a standalone Node service (`apps/socket-server`) — Vercel does not support long-lived WebSocket connections, so it cannot live in `apps/web`.
- Database is Postgres via the local Docker Compose container in dev, accessed through Prisma from a single shared `packages/database` package — never a second, divergent schema.
- Auth is Auth.js v5 using JWT session strategy — `apps/socket-server` verifies the session itself via `NEXTAUTH_SECRET`, with no HTTP call back to `apps/web`. **Auth.js v5 issues encrypted JWEs** (`alg: "dir"`, `enc: "A256CBC-HS512"`), decoded via `next-auth/jwt`'s `decode({ token, secret, salt })` where `salt` is the exact session cookie name (`authjs.session-token` for local http dev — this project does not yet handle the `__Secure-` prefixed cookie name used over https; that's a Phase 9 deployment concern, not this phase's).
- Exactly three roles per server: `OWNER`, `ADMIN`, `MEMBER`. No custom permission bitfields — all permission checks flow through `@repo/permissions`'s existing `canCreateChannel`, `canDeleteChannel`, `canKickMember`, `canDeleteMessage` (already implemented and tested; this phase is the first to consume the latter three).
- No voice/video, no message edit history, no reactions/threads, no read receipts — out of scope per spec.
- Tests use Vitest. Business logic (permission helpers, validators, the JWT-decode helper, the membership-lookup helper) and API routes are unit/integration tested against real Postgres (never mocked, per this project's established testing philosophy). **Realtime socket behavior (broadcast, typing, presence) is verified manually in-browser per phase, not automated** — this is an explicit choice from the design spec, not a gap: automating Socket.IO round-trips in Vitest was assessed as high harness-complexity for low payoff at this project's scope. Each phase's checkpoint below gives concrete manual steps.
- `apps/web`'s Vitest suite runs against a dedicated `discord_clone_test` database (never the dev database) with `fileParallelism: false` — this is already configured in `apps/web/vitest.config.ts`. Any new DB-touching test file in `apps/socket-server` needs the equivalent isolation added (Task 3.4 does this — `apps/socket-server` currently has no DB-touching tests beyond a trivial "prisma client exists" check, so this hasn't been needed until now).
- **Presence broadcast scope (intentional simplification, disclosed here rather than discovered later):** `presence:update` is broadcast to every connected socket (`io.emit`), not scoped to sockets whose users share a server with the affected user. Computing the correct per-user audience would require querying every server the affected user belongs to and filtering connected sockets by membership — real Discord-scale complexity this portfolio project's scope doesn't warrant. Every logged-in user sees every other logged-in user's presence changes; this is a known, deliberate trade-off, not a bug to fix later in this plan.
- Message content has no maximum length enforced anywhere in this phase (matches the project's existing minimal-validation style — e.g. server/channel names only check non-empty-after-trim). Not a gap to flag against this plan.
- **`apps/web` API route tests that mock `@/lib/auth`'s `auth()` must cast through `Mock`, not use `vi.mocked(auth)` directly.** Auth.js v5's exported `auth` is an intersection of multiple overloaded call signatures; `vi.mocked()` picks the wrong overload and fails `next build`'s TypeScript pass (not `vitest run`, which doesn't typecheck — the failure only surfaces at build time). The established, already-proven-correct pattern in this codebase (originally fixed in the Phase 0-2 branch's post-review fix wave) is: `import { ..., type Mock } from 'vitest'` and `;(auth as unknown as Mock).mockResolvedValue(...)`. Every task below that mocks `auth()` already uses this pattern in its code block — this note just documents why, so the pattern isn't mistaken for an odd style choice worth "cleaning up."

---

## Phase 3: Real-Time Text Chat Core

**Deliverable:** Two logged-in users, each with a browser open to the same channel, see each other's messages appear live; reloading either window re-loads the channel's message history from the database.

### Task 3.1: Add the `Message` model to the schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `Message` model (`id`, `content`, `authorId`, `channelId`, `createdAt`), with `author User` and `channel Channel` relations (both `onDelete: Cascade`, matching every other relation in this schema). Reverse relations added to `User` (`messages Message[]`) and `Channel` (`messages Message[]`). Every later task in this phase persists/reads through this model.
- Note for whoever writes the Phase 6-9 plan: the design spec's data model has `Message.channelId`/`dmConversationId` as mutually-exclusive optional fields once DMs exist. This task deliberately adds `channelId` as **required** (DMs are out of scope until Phase 6) — Phase 6's plan will need a migration that makes `channelId` optional and adds `dmConversationId` alongside a check that exactly one is set. Don't let that surprise the Phase 6 author; it's expected, not an oversight here.

- [ ] **Step 1: Add the `Message` model to `packages/database/prisma/schema.prisma`** (append after the existing `Channel` model — do not remove or reorder anything else)

```prisma
model Message {
  id        String   @id @default(cuid())
  content   String
  authorId  String
  channelId String
  createdAt DateTime @default(now())

  author  User    @relation(fields: [authorId], references: [id], onDelete: Cascade)
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Add the reverse relations**

In the existing `Channel` model, add this field alongside `server`:

```prisma
  messages Message[]
```

In the existing `User` model, add this field alongside `memberships` and `ownedServers`:

```prisma
  messages Message[]
```

- [ ] **Step 3: Regenerate the client and migrate**

Run (requires the local Postgres container from Phase 0 running — `docker compose ps` from the repo root; `docker compose up -d` if it isn't):
```bash
npm run generate --workspace=packages/database
npm run migrate:dev --workspace=packages/database -- --name add_message_model
```
Expected: both commands succeed; the migrate command prints "Your database is now in sync with your schema", creating `packages/database/prisma/migrations/<timestamp>_add_message_model/`.

- [ ] **Step 4: Apply the same migration to the test database**

Run: `npm run migrate:test --workspace=packages/database`
Expected: "1 migration found" (or similar) applies cleanly with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add Message model"
```

### Task 3.2: JWT/JWE session-cookie decode helper in `apps/socket-server`

**Files:**
- Create: `apps/socket-server/src/auth.ts`
- Test: `apps/socket-server/src/auth.test.ts`

**Interfaces:**
- Consumes: `NEXTAUTH_SECRET` env var (must match `apps/web`'s exactly — same secret signs/encrypts sessions on both sides).
- Produces: `getUserIdFromCookieHeader(cookieHeader: string | undefined): Promise<string | null>` — the function every later socket-auth task in this phase calls to turn a raw `Cookie` HTTP header into an authenticated user id, or `null` if there's no valid session. Never throws.

- [ ] **Step 1: Write the failing tests**

Create `apps/socket-server/src/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encode } from 'next-auth/jwt'
import { getUserIdFromCookieHeader } from './auth'

const TEST_SECRET = 'test-secret-for-jwt-round-trip-only'
const SESSION_COOKIE_NAME = 'authjs.session-token'

describe('getUserIdFromCookieHeader', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = TEST_SECRET
  })

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalSecret
  })

  it('extracts the user id from a validly encoded session cookie', async () => {
    const token = await encode({
      secret: TEST_SECRET,
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-123', email: 'a@example.com' },
    })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBe('user-123')
  })

  it('finds the session cookie among other cookies', async () => {
    const token = await encode({
      secret: TEST_SECRET,
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-456' },
    })

    const result = await getUserIdFromCookieHeader(`other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; another=2`)

    expect(result).toBe('user-456')
  })

  it('returns null when no cookie header is present', async () => {
    const result = await getUserIdFromCookieHeader(undefined)
    expect(result).toBeNull()
  })

  it('returns null when the session cookie is missing from the header', async () => {
    const result = await getUserIdFromCookieHeader('other-cookie=value')
    expect(result).toBeNull()
  })

  it('returns null when the token cannot be decrypted (wrong secret)', async () => {
    const token = await encode({
      secret: 'a-completely-different-secret',
      salt: SESSION_COOKIE_NAME,
      token: { id: 'user-789' },
    })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBeNull()
  })

  it('returns null when NEXTAUTH_SECRET is not set', async () => {
    process.env.NEXTAUTH_SECRET = ''
    const token = await encode({ secret: TEST_SECRET, salt: SESSION_COOKIE_NAME, token: { id: 'user-1' } })

    const result = await getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)

    expect(result).toBeNull()
  })

  it('returns null (does not throw/reject) when the session cookie value is malformed percent-encoding', async () => {
    await expect(getUserIdFromCookieHeader(`${SESSION_COOKIE_NAME}=%zz`)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/socket-server -- auth.test.ts`
Expected: FAIL — `./auth` has no exported member `getUserIdFromCookieHeader`, because `src/auth.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/socket-server/src/auth.ts`**

```typescript
import { decode } from 'next-auth/jwt'

const SESSION_COOKIE_NAME = 'authjs.session-token'

function extractCookieValue(cookieHeader: string, name: string): string | null {
  for (const entry of cookieHeader.split(';')) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex === -1) continue
    const key = entry.slice(0, separatorIndex).trim()
    if (key === name) {
      return decodeURIComponent(entry.slice(separatorIndex + 1).trim())
    }
  }
  return null
}

export async function getUserIdFromCookieHeader(cookieHeader: string | undefined): Promise<string | null> {
  if (!cookieHeader) return null

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return null

  try {
    const token = extractCookieValue(cookieHeader, SESSION_COOKIE_NAME)
    if (!token) return null

    const payload = await decode({ token, secret, salt: SESSION_COOKIE_NAME })
    const userId = payload?.id
    return typeof userId === 'string' ? userId : null
  } catch {
    return null
  }
}
```

**Important note for the implementer:** `decode()` from `next-auth/jwt` (re-exported from `@auth/core/jwt`) throws on a decryption failure (wrong secret, corrupted token, wrong salt) — it does NOT return `null` for that case, only for a missing `token`. `extractCookieValue`'s `decodeURIComponent` call can also throw (`URIError`) on a malformed percent-encoded cookie value. Both calls must be inside the `try/catch` above — the `Cookie` header is attacker-controlled input at this exact auth boundary, and a crash here (an unhandled rejection from this `async` function) takes down the whole socket server, not just one connection. This isn't defensive over-engineering; omitting either call from the try block will crash the Socket.IO connection middleware in Task 3.3 on the first malformed, expired, or wrong-secret cookie it sees.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/socket-server -- auth.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/auth.ts apps/socket-server/src/auth.test.ts
git commit -m "feat: add Auth.js JWE session-cookie decoder to socket-server"
```

### Task 3.3: Socket.IO connection auth middleware + client dependency

**Files:**
- Modify: `apps/socket-server/src/index.ts`
- Create: `apps/socket-server/src/types.ts`
- Modify: `apps/web/package.json` (add `socket.io-client` dependency)

**Interfaces:**
- Consumes: `getUserIdFromCookieHeader` (Task 3.2).
- Produces: every socket connection reaching a handler in this phase has `socket.data.userId: string` already populated and verified — no later task needs to re-check authentication, only authorization (membership/role) for the specific action. Also produces the shared `SocketData`/`TypedServer`/`TypedSocket` type exports in `apps/socket-server/src/types.ts` that every later handler-registration task in this phase imports and extends.

- [ ] **Step 1: Create `apps/socket-server/src/types.ts`**

```typescript
import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

export interface ClientToServerEvents {
  // Extended by later tasks in this phase (channel:join, message:new, typing:start, ...)
}

export interface ServerToClientEvents {
  // Extended by later tasks in this phase (message:new, typing:start, presence:update, ...)
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 2: Wire the auth middleware and type the `Server` instance in `apps/socket-server/src/index.ts`**

Replace the file's contents with:

```typescript
import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { fileURLToPath } from 'url'
import path from 'path'
import { getUserIdFromCookieHeader } from './auth.js'
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from './types.js'

export function createServer() {
  const app = express()
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const httpServer = createHttpServer(app)
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: {
      origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    const userId = await getUserIdFromCookieHeader(socket.handshake.headers.cookie)
    if (!userId) {
      next(new Error('Unauthorized'))
      return
    }
    socket.data.userId = userId
    next()
  })

  return { app, httpServer, io }
}

const isMain = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (isMain) {
  const { httpServer } = createServer()
  const port = process.env.PORT ? Number(process.env.PORT) : 4000
  httpServer.listen(port, () => {
    console.log(`socket-server listening on port ${port}`)
  })
}
```

Note: `cors: { credentials: true }` is required for the browser to send the httpOnly `authjs.session-token` cookie during the Socket.IO handshake — without it, the middleware above will reject every real browser connection with "Unauthorized" even when the user is genuinely logged in. Also note the CORS `origin` can no longer be `*`/omitted once `credentials: true` is set (browsers reject that combination) — it already isn't (`WEB_ORIGIN` is an explicit origin), so no change needed there.

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm test --workspace=apps/socket-server`
Expected: PASS — the existing `health check` and `database package` suites, plus Task 3.2's `auth.test.ts`, all pass (the `/health` route doesn't go through Socket.IO's auth middleware, so it's unaffected).

- [ ] **Step 4: Add `socket.io-client` to `apps/web`**

Run: `npm install socket.io-client@^4.7.5 --workspace=apps/web`
Expected: completes with no errors; `apps/web/package.json` now lists `socket.io-client` under `dependencies`.

- [ ] **Step 5: Create your local `apps/socket-server/.env` if you haven't already**

This file is gitignored — each developer creates their own. It must exist for Task 3.9's manual checkpoint (and every later phase's) to work, and its `NEXTAUTH_SECRET` **must exactly match** `apps/web/.env.local`'s `NEXTAUTH_SECRET` — the two apps decrypt each other's session tokens using this shared value.

Create `apps/socket-server/.env`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/discord_clone_dev"
NEXTAUTH_SECRET="<paste the exact same value from apps/web/.env.local>"
PORT=4000
WEB_ORIGIN="http://localhost:3000"
```

- [ ] **Step 6: Commit**

```bash
git add apps/socket-server/src/index.ts apps/socket-server/src/types.ts apps/web/package.json package-lock.json
git commit -m "feat: add Socket.IO connection auth middleware"
```

(`apps/socket-server/.env` is gitignored and intentionally not committed.)

### Task 3.4: Membership lookup helper + `channel:join`/`channel:leave` handlers

**Files:**
- Create: `apps/socket-server/src/membership.ts`
- Test: `apps/socket-server/src/membership.test.ts`
- Create: `apps/socket-server/src/channels.ts`
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/index.ts`
- Modify: `apps/socket-server/vitest.config.ts` (test database isolation)

**Interfaces:**
- Consumes: `prisma` from `@repo/database` (existing), `SocketData`/`TypedServer`/`TypedSocket` (Task 3.3).
- Produces: `getServerMembership(userId: string, channelId: string): Promise<{ serverId: string; role: Role } | null>` — the authorization check every later handler in this phase that operates on a specific channel calls (Task 3.5's `message:new`, Task 5.4's `message:delete`). Also produces `registerChannelHandlers(io: TypedServer, socket: TypedSocket): void`, which every later handler-registration task in this phase follows as the pattern for wiring a domain's socket events.

- [ ] **Step 1: Give `apps/socket-server`'s Vitest suite its own test database**

This is the first test file in `apps/socket-server` that creates real `User`/`Server`/`Membership`/`Channel` rows — until now its only DB-touching test just checked `prisma` was defined. Point it at the same dedicated test database `apps/web` already uses, so neither workspace's suite can step on the dev database or on each other.

Replace `apps/socket-server/vitest.config.ts`'s contents with:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Mirrors apps/web/vitest.config.ts: tests create/delete real rows via
    // @repo/database — point at the dedicated test DB, never the dev DB.
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/discord_clone_test',
    },
    fileParallelism: false,
  },
})
```

- [ ] **Step 2: Write the failing test for `getServerMembership`**

Create `apps/socket-server/src/membership.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { getServerMembership } from './membership'

describe('getServerMembership', () => {
  let serverId: string
  let channelId: string
  let memberUserId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'socket-member@example.com' } })

    const user = await prisma.user.create({ data: { email: 'socket-member@example.com', name: 'Socket Member' } })
    memberUserId = user.id

    const server = await prisma.server.create({
      data: { name: 'Socket Test Server', ownerId: user.id, memberships: { create: { userId: user.id, role: 'OWNER' } } },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'general', serverId } })
    channelId = channel.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: 'socket-member@example.com' } })
  })

  it('returns the serverId and role for a member of the channel\'s server', async () => {
    const result = await getServerMembership(memberUserId, channelId)
    expect(result).toEqual({ serverId, role: 'OWNER' })
  })

  it('returns null for a user who is not a member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'socket-outsider@example.com', name: 'Outsider' } })
    const result = await getServerMembership(outsider.id, channelId)
    await prisma.user.delete({ where: { id: outsider.id } })
    expect(result).toBeNull()
  })

  it('returns null for a channel that does not exist', async () => {
    const result = await getServerMembership(memberUserId, 'nonexistent-channel-id')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace=apps/socket-server -- membership.test.ts`
Expected: FAIL — `./membership` has no exported member `getServerMembership`, because `src/membership.ts` doesn't exist yet.

- [ ] **Step 4: Create `apps/socket-server/src/membership.ts`**

```typescript
import { prisma, type Role } from '@repo/database'

export async function getServerMembership(
  userId: string,
  channelId: string
): Promise<{ serverId: string; role: Role } | null> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { serverId: true } })
  if (!channel) return null

  const membership = await prisma.membership.findUnique({
    where: { userId_serverId: { userId, serverId: channel.serverId } },
  })
  if (!membership) return null

  return { serverId: channel.serverId, role: membership.role }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=apps/socket-server -- membership.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 6: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s contents with:

```typescript
import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
}

export interface ServerToClientEvents {
  // Extended by later tasks in this phase (message:new, typing:start, presence:update, ...)
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 7: Create `apps/socket-server/src/channels.ts`**

No automated test for this file — per this plan's Global Constraints, actual Socket.IO event wiring is verified manually (Task 3.9's checkpoint exercises this). The authorization logic it depends on (`getServerMembership`) is already tested above.

```typescript
import type { TypedServer, TypedSocket } from './types.js'
import { getServerMembership } from './membership.js'

function channelRoom(channelId: string): string {
  return `channel:${channelId}`
}

export function registerChannelHandlers(_io: TypedServer, socket: TypedSocket) {
  socket.on('channel:join', async ({ channelId }, ack) => {
    const membership = await getServerMembership(socket.data.userId, channelId)
    if (!membership) {
      ack({ ok: false, error: 'Not a member of this channel\'s server' })
      return
    }

    socket.join(channelRoom(channelId))
    ack({ ok: true })
  })

  socket.on('channel:leave', ({ channelId }) => {
    socket.leave(channelRoom(channelId))
  })
}

export { channelRoom }
```

- [ ] **Step 8: Wire it into `createServer()`**

Modify `apps/socket-server/src/index.ts`: add the import near the top, alongside the existing imports:

```typescript
import { registerChannelHandlers } from './channels.js'
```

Add this block right after the `io.use(...)` middleware block (before the `return { app, httpServer, io }` line):

```typescript
  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
  })
```

- [ ] **Step 9: Run the full socket-server suite and verify the app builds**

Run:
```bash
npm test --workspace=apps/socket-server
npm run build --workspace=apps/socket-server
```
Expected: all tests pass; the build compiles with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add apps/socket-server/src/membership.ts apps/socket-server/src/membership.test.ts apps/socket-server/src/channels.ts apps/socket-server/src/types.ts apps/socket-server/src/index.ts apps/socket-server/vitest.config.ts
git commit -m "feat: add channel:join/channel:leave socket handlers with membership authorization"
```

### Task 3.5: `message:new` handler — persist and broadcast

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Create: `apps/socket-server/src/messages.ts`
- Modify: `apps/socket-server/src/index.ts`

**Interfaces:**
- Consumes: `getServerMembership` (Task 3.4), `prisma` from `@repo/database`.
- Produces: `MessagePayload` type (`{ id, content, channelId, createdAt, author: { id, name, image } }`) — Task 3.6's REST history endpoint and Task 3.8's client `ChatPanel` both use this exact shape, so the two sources (live broadcast vs. history load) render identically with no client-side mapping differences.

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s contents with:

```typescript
import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

export interface MessagePayload {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 2: Create `apps/socket-server/src/messages.ts`**

No automated test — same reasoning as Task 3.4's `channels.ts` (Socket.IO wiring is manually verified; the DB-touching logic it needs is either trivial `prisma.message.create` or already covered by `getServerMembership`'s tests).

```typescript
import { prisma } from '@repo/database'
import type { TypedServer, TypedSocket, MessagePayload } from './types.js'
import { getServerMembership } from './membership.js'
import { channelRoom } from './channels.js'

export function registerMessageHandlers(io: TypedServer, socket: TypedSocket) {
  socket.on('message:new', async ({ channelId, content }, ack) => {
    const membership = await getServerMembership(socket.data.userId, channelId)
    if (!membership) {
      ack({ ok: false, error: 'Not a member of this channel\'s server' })
      return
    }

    const trimmed = content.trim()
    if (!trimmed) {
      ack({ ok: false, error: 'Message content is required' })
      return
    }

    const message = await prisma.message.create({
      data: { content: trimmed, channelId, authorId: socket.data.userId },
      include: { author: { select: { id: true, name: true, image: true } } },
    })

    const payload: MessagePayload = {
      id: message.id,
      content: message.content,
      channelId: message.channelId,
      createdAt: message.createdAt.toISOString(),
      author: message.author,
    }

    io.to(channelRoom(channelId)).emit('message:new', payload)
    ack({ ok: true })
  })
}
```

- [ ] **Step 3: Wire it into `createServer()`**

Modify `apps/socket-server/src/index.ts`: add the import:

```typescript
import { registerMessageHandlers } from './messages.js'
```

Update the `io.on('connection', ...)` block added in Task 3.4 to also register message handlers:

```typescript
  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
    registerMessageHandlers(io, socket)
  })
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/messages.ts apps/socket-server/src/index.ts
git commit -m "feat: add message:new socket handler (persist + broadcast)"
```

### Task 3.6: Message history REST endpoint

**Files:**
- Create: `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts`
- Test: `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.test.ts`

**Interfaces:**
- Consumes: `requireMembership` (existing, from Phase 2's fix wave), `prisma` from `@repo/database`.
- Produces: `GET /api/servers/:serverId/channels/:channelId/messages` returning `200` with an array of messages in the exact `MessagePayload` shape Task 3.5 defined (`{ id, content, channelId, createdAt, author: { id, name, image } }`), oldest first. Returns `403` if the caller isn't a member of `serverId`, `404` if `channelId` doesn't belong to `serverId`. Task 3.8's `ChatPanel` calls this on mount to load history before live messages start arriving.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/servers/:serverId/channels/:channelId/messages', () => {
  let serverId: string
  let channelId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['msg-owner@example.com', 'msg-outsider@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'msg-owner@example.com', name: 'Owner' } })
    memberId = owner.id

    const server = await prisma.server.create({
      data: { name: 'Message History Server', ownerId: owner.id, memberships: { create: { userId: owner.id, role: 'OWNER' } } },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'general', serverId } })
    channelId = channel.id

    await prisma.message.create({ data: { content: 'first message', channelId, authorId: owner.id } })
    await prisma.message.create({ data: { content: 'second message', channelId, authorId: owner.id } })
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['msg-owner@example.com', 'msg-outsider@example.com'] } } })
  })

  it('returns messages oldest-first with author info', async () => {
    mockSession(memberId)
    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId, channelId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].content).toBe('first message')
    expect(body[1].content).toBe('second message')
    expect(body[0].author).toEqual({ id: memberId, name: 'Owner', image: null })
  })

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'msg-outsider@example.com', name: 'Outsider' } })
    mockSession(outsider.id)

    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(403)
  })

  it('returns 404 when the channel does not belong to the server', async () => {
    mockSession(memberId)
    const otherServer = await prisma.server.create({
      data: { name: 'Other Server', ownerId: memberId, memberships: { create: { userId: memberId, role: 'OWNER' } } },
    })

    const response = await GET(new Request('http://localhost/api/servers/x/channels/y/messages'), {
      params: Promise.resolve({ serverId: otherServer.id, channelId }),
    })

    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- messages/route.test.ts`
Expected: FAIL — `./route` has no exported member `GET`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
) {
  const { serverId, channelId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  const channel = await prisma.channel.findFirst({ where: { id: channelId, serverId } })
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  const messages = await prisma.message.findMany({
    where: { channelId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, image: true } } },
  })

  const payload = messages.map((message) => ({
    id: message.id,
    content: message.content,
    channelId: message.channelId,
    createdAt: message.createdAt.toISOString(),
    author: message.author,
  }))

  return NextResponse.json(payload, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- messages/route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages"
git commit -m "feat: add channel message history endpoint"
```

### Task 3.7: Client-side socket connection singleton

**Files:**
- Create: `apps/web/src/lib/socket.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SOCKET_SERVER_URL` env var (already documented in `apps/web/.env.example` since Phase 0).
- Produces: `getSocket(): Socket` — a lazily-created, module-level singleton Socket.IO client connection. Task 3.8's `ChatPanel` (and every later phase's real-time UI) calls this instead of constructing its own connection, so the app maintains exactly one WebSocket connection regardless of how many components need socket access.

- [ ] **Step 1: Create `apps/web/src/lib/socket.ts`**

No automated test — this is a thin wrapper around `socket.io-client`'s own `io()` constructor with no branching logic of its own to unit test; its behavior is exercised by Task 3.9's manual checkpoint.

```typescript
import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ?? 'http://localhost:4000', {
      withCredentials: true,
    })
  }
  return socket
}
```

`withCredentials: true` is required so the browser sends the httpOnly `authjs.session-token` cookie with the connection handshake — this is the client-side half of Task 3.3's `cors: { credentials: true }` server-side change; both are needed for the auth middleware to see the cookie at all.

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/socket.ts
git commit -m "feat: add client-side Socket.IO connection singleton"
```

### Task 3.8: Chat UI

**Files:**
- Create: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/components/ChannelList.tsx`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Consumes: `getSocket` (Task 3.7), `GET /api/servers/:serverId/channels/:channelId/messages` (Task 3.6), the `channel:join`/`channel:leave`/`message:new` socket events (Tasks 3.4-3.5).
- Produces: the `(main)` route group's actual chat experience — replaces `ChannelList`'s Phase-3 placeholder text. Task 4.2 (typing indicator) and Task 5.5 (delete-message control) both extend this same `ChatPanel` component.

- [ ] **Step 1: Create `apps/web/src/components/ChatPanel.tsx`**

No automated test — this component's only logic (socket event handling, fetch-then-render) is UI wiring already covered by Task 3.6's route tests and Task 3.4/3.5's socket-side logic tests; the live end-to-end behavior is verified manually (Task 3.9).

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'

type Message = {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

export function ChatPanel({ serverId, channelId }: { serverId: string; channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const response = await fetch(`/api/servers/${serverId}/channels/${channelId}/messages`)
      if (response.ok && !cancelled) {
        // Merge (not replace) so a message:new event that arrives while this
        // fetch is still in flight isn't dropped or duplicated once history
        // resolves — dedupe by id, history first (already oldest-first),
        // then any live-only message not yet reflected in history.
        const history: Message[] = await response.json()
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id))
          const liveOnly = prev.filter((m) => !historyIds.has(m.id))
          return [...history, ...liveOnly]
        })
      }
    }
    loadHistory()

    const socket = getSocket()
    socket.emit('channel:join', { channelId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok && !cancelled) setError(response.error)
    })

    function handleNewMessage(message: Message) {
      if (message.channelId === channelId) {
        setMessages((prev) => [...prev, message])
      }
    }
    socket.on('message:new', handleNewMessage)

    return () => {
      cancelled = true
      socket.emit('channel:leave', { channelId })
      socket.off('message:new', handleNewMessage)
    }
  }, [serverId, channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) return
    setError('')

    getSocket().emit('message:new', { channelId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-2">
            <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
            <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
            <p>{message.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-3 text-xs text-red-500">{error}</p>}
      <form onSubmit={sendMessage} className="flex gap-2 border-t p-3">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Message"
          className="flex-1 rounded border p-2 text-sm"
        />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-sm text-white">Send</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Wire channel selection out of `ChannelList` and into the parent page**

`ChannelList` currently owns its own `selectedChannel` state and renders a placeholder. Move that selection state up to `(main)/page.tsx` (same pattern already used for `activeServerId`), so the page can render `ChatPanel` as a sibling.

Replace `apps/web/src/components/ChannelList.tsx`'s contents with:

```typescript
'use client'

import { useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type Channel = { id: string; name: string }

export function ChannelList({
  serverId,
  channels,
  selectedChannelId,
  onSelectChannel,
  onChannelsChanged,
}: {
  serverId: string
  channels: Channel[]
  selectedChannelId: string | null
  onSelectChannel: (channelId: string) => void
  onChannelsChanged: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function createChannel() {
    if (!name.trim()) return
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setName('')
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex w-52 flex-col gap-2 border-r p-3">
      <h3 className="font-bold"># Channels</h3>
      <ul className="flex flex-col gap-1">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              onClick={() => onSelectChannel(channel.id)}
              className={`w-full rounded p-1 text-left text-sm ${selectedChannelId === channel.id ? 'bg-indigo-100' : ''}`}
            >
              # {channel.name}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex flex-col gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New channel name" className="rounded border p-1 text-sm" />
        <button onClick={createChannel} className="rounded border p-1 text-sm">Create channel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render `ChatPanel` from the page**

Replace `apps/web/src/app/(main)/page.tsx`'s contents with:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { ServerSidebar } from '@/components/ServerSidebar'
import { ChannelList } from '@/components/ChannelList'
import { ChatPanel } from '@/components/ChatPanel'

type Channel = { id: string; name: string }
type Server = { id: string; name: string; channels: Channel[] }

export default function HomePage() {
  const [servers, setServers] = useState<Server[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  async function loadServers() {
    const response = await fetch('/api/servers')
    if (response.ok) {
      const data = await response.json()
      setServers(data)
    }
  }

  useEffect(() => {
    loadServers()
  }, [])

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null

  return (
    <>
      <ServerSidebar
        servers={servers}
        activeServerId={activeServerId}
        onSelect={(serverId) => {
          setActiveServerId(serverId)
          setSelectedChannelId(null)
        }}
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, channels: [] }])
          setActiveServerId(server.id)
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
      />
      {activeServer ? (
        <>
          <ChannelList
            serverId={activeServer.id}
            channels={activeServer.channels}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            onChannelsChanged={loadServers}
          />
          {selectedChannelId ? (
            <ChatPanel serverId={activeServer.id} channelId={selectedChannelId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a channel</div>
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">Select or create a server</div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Verify the app builds and existing tests still pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build compiles successfully; all existing tests still pass (nothing in this step changed API route behavior).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/components/ChannelList.tsx "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: add real-time chat UI"
```

### Task 3.9: Phase 3 manual checkpoint

Both `apps/socket-server` and `apps/web` must be running, plus the Postgres container.

- [ ] **Step 1: Start everything**

In separate terminals from the repo root:
```bash
docker compose up -d
npm run dev:socket
npm run dev:web
```

- [ ] **Step 2: Two-window live chat test**

1. Open `http://localhost:3000` in two browser windows (use an incognito/private window for the second, or two different browsers, so they get separate sessions).
2. Sign up as User A in window 1, User B in window 2.
3. As User A: create a server, add a channel, copy the server ID, select the channel.
4. As User B: join the server using the copied ID, select the same channel.
5. As User A: type a message and send it. **Expected: it appears immediately in both windows.**
6. As User B: reply. **Expected: it appears immediately in both windows.**
7. Reload window B. **Expected: both prior messages reload from history, in the same order, with the correct author names.**

- [ ] **Step 3: Stop everything**

Stop both dev servers (Ctrl+C in each terminal). Leave the Postgres container running (or `docker compose down` if you're done for the session — either is fine, it'll restart cleanly next time).

**Phase 3 checkpoint:** real-time chat works end-to-end — join, send, receive live, reload-and-reload-history. This is the point to stop and verify locally before continuing to Phase 4.

---

## Phase 4: Presence + Typing Indicators

**Deliverable:** Two users in the same channel see "X is typing…" live while the other is composing a message, and see each other's online/offline status update live in a member list.

### Task 4.1: `typing:start` / `typing:stop` handlers

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Create: `apps/socket-server/src/typing.ts`
- Modify: `apps/socket-server/src/index.ts`

**Interfaces:**
- Consumes: `channelRoom` (Task 3.4), `TypedServer`/`TypedSocket` (Task 3.3).
- Produces: `typing:start`/`typing:stop` broadcast (to everyone else in the channel's room, not the sender) carrying `{ channelId, userId }`. Task 4.2's client UI consumes these.

Note: these events are NOT membership-checked before broadcasting — a socket that already successfully joined the channel's room (Task 3.4's `channel:join`, which IS membership-checked) is implicitly authorized to signal typing in that room. This mirrors the design spec's description of typing as "broadcast only, never persisted" — no new authorization logic needed here, Socket.IO's room membership already gates it.

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s contents with:

```typescript
import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

export interface MessagePayload {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

export interface TypingPayload {
  channelId: string
  userId: string
}

export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'typing:start': (payload: { channelId: string }) => void
  'typing:stop': (payload: { channelId: string }) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 2: Create `apps/socket-server/src/typing.ts`**

No automated test — pure broadcast relay, no branching logic; verified manually (Task 4.6).

```typescript
import type { TypedServer, TypedSocket } from './types.js'
import { channelRoom } from './channels.js'

export function registerTypingHandlers(_io: TypedServer, socket: TypedSocket) {
  socket.on('typing:start', ({ channelId }) => {
    socket.to(channelRoom(channelId)).emit('typing:start', { channelId, userId: socket.data.userId })
  })

  socket.on('typing:stop', ({ channelId }) => {
    socket.to(channelRoom(channelId)).emit('typing:stop', { channelId, userId: socket.data.userId })
  })
}
```

`socket.to(...)` (not `io.to(...)`) is used deliberately — it broadcasts to everyone in the room EXCEPT the emitting socket, so a user never sees their own "is typing" indicator.

- [ ] **Step 3: Wire it into `createServer()`**

Modify `apps/socket-server/src/index.ts`: add the import:

```typescript
import { registerTypingHandlers } from './typing.js'
```

Update the connection block:

```typescript
  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
    registerMessageHandlers(io, socket)
    registerTypingHandlers(io, socket)
  })
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/typing.ts apps/socket-server/src/index.ts
git commit -m "feat: add typing:start/typing:stop socket handlers"
```

### Task 4.2: Typing indicator UI

**Files:**
- Modify: `apps/web/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: `typing:start`/`typing:stop` events (Task 4.1).
- Produces: a "X is typing…" line rendered in `ChatPanel` whenever another user in the channel is actively typing, debounced so a `typing:stop` is emitted automatically 2 seconds after the last keystroke (so a user who stops typing without sending doesn't leave a stale indicator on other clients).

- [ ] **Step 1: Add typing state, emission, and the indicator to `ChatPanel`**

Replace `apps/web/src/components/ChatPanel.tsx`'s contents with:

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'

type Message = {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

const TYPING_STOP_DELAY_MS = 2000

export function ChatPanel({ serverId, channelId }: { serverId: string; channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const response = await fetch(`/api/servers/${serverId}/channels/${channelId}/messages`)
      if (response.ok && !cancelled) {
        // Merge (not replace) so a message:new event that arrives while this
        // fetch is still in flight isn't dropped or duplicated once history
        // resolves — dedupe by id, history first (already oldest-first),
        // then any live-only message not yet reflected in history.
        const history: Message[] = await response.json()
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id))
          const liveOnly = prev.filter((m) => !historyIds.has(m.id))
          return [...history, ...liveOnly]
        })
      }
    }
    loadHistory()

    const socket = getSocket()
    socket.emit('channel:join', { channelId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok && !cancelled) setError(response.error)
    })

    function handleNewMessage(message: Message) {
      if (message.channelId === channelId) {
        setMessages((prev) => [...prev, message])
      }
    }
    function handleTypingStart({ channelId: eventChannelId, userId }: { channelId: string; userId: string }) {
      if (eventChannelId !== channelId) return
      setTypingUserIds((prev) => new Set(prev).add(userId))
    }
    function handleTypingStop({ channelId: eventChannelId, userId }: { channelId: string; userId: string }) {
      if (eventChannelId !== channelId) return
      setTypingUserIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }

    socket.on('message:new', handleNewMessage)
    socket.on('typing:start', handleTypingStart)
    socket.on('typing:stop', handleTypingStop)

    return () => {
      cancelled = true
      socket.emit('channel:leave', { channelId })
      socket.off('message:new', handleNewMessage)
      socket.off('typing:start', handleTypingStart)
      socket.off('typing:stop', handleTypingStop)
      setTypingUserIds(new Set())
    }
  }, [serverId, channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleContentChange(event: React.ChangeEvent<HTMLInputElement>) {
    setContent(event.target.value)

    const socket = getSocket()
    socket.emit('typing:start', { channelId })

    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    typingStopTimer.current = setTimeout(() => {
      socket.emit('typing:stop', { channelId })
    }, TYPING_STOP_DELAY_MS)
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) return
    setError('')

    const socket = getSocket()
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    socket.emit('typing:stop', { channelId })

    socket.emit('message:new', { channelId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-2">
            <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
            <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
            <p>{message.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {typingUserIds.size > 0 && (
        <p className="px-3 text-xs text-gray-500 italic">
          {typingUserIds.size === 1 ? 'Someone is typing…' : `${typingUserIds.size} people are typing…`}
        </p>
      )}
      {error && <p className="px-3 text-xs text-red-500">{error}</p>}
      <form onSubmit={sendMessage} className="flex gap-2 border-t p-3">
        <input
          value={content}
          onChange={handleContentChange}
          placeholder="Message"
          className="flex-1 rounded border p-2 text-sm"
        />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-sm text-white">Send</button>
      </form>
    </div>
  )
}
```

Note: the indicator shows "Someone is typing…" rather than a name, because `typing:start`'s payload only carries `userId`, not a display name — resolving a name would mean either a lookup per typing event or threading the member list (Task 4.5) into this component. Given typing indicators are inherently transient, "Someone/N people are typing…" is judged sufficient for this project's scope; upgrading it to show names is straightforward once Task 4.5's member list data is available in the parent, but isn't required by this task.

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx
git commit -m "feat: add typing indicator UI"
```

### Task 4.3: Presence — connect/disconnect with grace period

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Create: `apps/socket-server/src/presence.ts`
- Modify: `apps/socket-server/src/index.ts`

**Interfaces:**
- Consumes: `prisma` from `@repo/database` (updates `User.status`).
- Produces: `presence:update` broadcast (`{ userId, status }`, `status` one of `'ONLINE' | 'IDLE' | 'OFFLINE'`) whenever a user's persisted status changes, driven by socket connect (→ `ONLINE`) and disconnect (→ `OFFLINE` after a grace period, so a page refresh or brief network blip doesn't flicker a user's status to everyone). Task 4.4 adds the idle-timeout half of this same status; Task 4.5's member list UI consumes the broadcasts.

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s contents with:

```typescript
import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

export interface MessagePayload {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

export interface TypingPayload {
  channelId: string
  userId: string
}

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'OFFLINE'

export interface PresencePayload {
  userId: string
  status: PresenceStatus
}

export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'typing:start': (payload: { channelId: string }) => void
  'typing:stop': (payload: { channelId: string }) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
  'presence:update': (payload: PresencePayload) => void
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 2: Create `apps/socket-server/src/presence.ts`**

No automated test — this file's only branching logic is a setTimeout-gated DB write + broadcast, which the design spec's testing philosophy explicitly assigns to manual verification (Task 4.6) rather than automation. The `Map`-based per-user tracking below is straightforward enough that a unit test would mostly be re-asserting `setTimeout`/`clearTimeout` semantics, not this project's own logic.

```typescript
import { prisma } from '@repo/database'
import type { TypedServer, TypedSocket, PresenceStatus } from './types.js'

const OFFLINE_GRACE_PERIOD_MS = 10_000

// Tracks pending "mark offline" timers per user, so a quick reconnect (page
// refresh, brief network blip) cancels the pending offline transition instead
// of flickering the user's status to everyone.
const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function setStatus(io: TypedServer, userId: string, status: PresenceStatus) {
  await prisma.user.update({ where: { id: userId }, data: { status } })
  io.emit('presence:update', { userId, status })
}

export function registerPresenceHandlers(io: TypedServer, socket: TypedSocket) {
  const { userId } = socket.data

  const pendingTimer = pendingOfflineTimers.get(userId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingOfflineTimers.delete(userId)
  }
  setStatus(io, userId, 'ONLINE')

  socket.on('disconnect', () => {
    const timer = setTimeout(() => {
      pendingOfflineTimers.delete(userId)
      setStatus(io, userId, 'OFFLINE')
    }, OFFLINE_GRACE_PERIOD_MS)
    pendingOfflineTimers.set(userId, timer)
  })
}
```

Note: this only handles the single-connection-per-user case correctly for "offline" (if the same user has two tabs open, the first tab's disconnect would start a grace-period timer that a still-open second tab doesn't cancel — after the grace period, that timer would incorrectly mark the user offline even though their second tab is still connected). This is a known, disclosed simplification appropriate for this project's scope (Discord itself handles multi-device presence with far more infrastructure); not a defect to chase down in this phase.

- [ ] **Step 3: Wire it into `createServer()`**

Modify `apps/socket-server/src/index.ts`: add the import:

```typescript
import { registerPresenceHandlers } from './presence.js'
```

Update the connection block:

```typescript
  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
    registerMessageHandlers(io, socket)
    registerTypingHandlers(io, socket)
    registerPresenceHandlers(io, socket)
  })
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/presence.ts apps/socket-server/src/index.ts
git commit -m "feat: add presence tracking with grace-period offline transition"
```

### Task 4.4: Idle detection

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/presence.ts`
- Create: `apps/web/src/lib/useIdleDetection.ts`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Consumes: `getSocket` (Task 3.7).
- Produces: a user who stops interacting with the tab (no mouse/keyboard activity, or the tab becomes hidden) for 5 minutes is marked `IDLE`; any activity or the tab becoming visible again marks them back `ONLINE`.

- [ ] **Step 1: Add `presence:idle`/`presence:active` to the shared event types**

Replace `apps/socket-server/src/types.ts`'s `ClientToServerEvents` interface (leave everything else in the file unchanged) with:

```typescript
export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'typing:start': (payload: { channelId: string }) => void
  'typing:stop': (payload: { channelId: string }) => void
  'presence:idle': () => void
  'presence:active': () => void
}
```

- [ ] **Step 2: Handle the new events in `apps/socket-server/src/presence.ts`**

Add these two lines inside `registerPresenceHandlers`, after the existing `socket.on('disconnect', ...)` block:

```typescript
  socket.on('presence:idle', () => {
    setStatus(io, userId, 'IDLE')
  })

  socket.on('presence:active', () => {
    setStatus(io, userId, 'ONLINE')
  })
```

- [ ] **Step 3: Create the client-side idle-detection hook**

No automated test — this hook wraps browser `document`/`window` event listeners and `setTimeout`, environment-dependent behavior that's more reliably checked by hand (Task 4.6) than by simulating browser idle time in Vitest's jsdom environment.

Create `apps/web/src/lib/useIdleDetection.ts`:

```typescript
'use client'

import { useEffect } from 'react'
import { getSocket } from './socket'

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'] as const

export function useIdleDetection() {
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>
    let isIdle = false

    function markActive() {
      if (isIdle) {
        isIdle = false
        getSocket().emit('presence:active')
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(markIdle, IDLE_TIMEOUT_MS)
    }

    function markIdle() {
      isIdle = true
      getSocket().emit('presence:idle')
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        markIdle()
        clearTimeout(idleTimer)
      } else {
        markActive()
      }
    }

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, markActive))
    document.addEventListener('visibilitychange', handleVisibilityChange)
    idleTimer = setTimeout(markIdle, IDLE_TIMEOUT_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActive))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTimeout(idleTimer)
    }
  }, [])
}
```

- [ ] **Step 4: Call the hook from the main page**

Modify `apps/web/src/app/(main)/page.tsx`: add the import near the top:

```typescript
import { useIdleDetection } from '@/lib/useIdleDetection'
```

Add this line as the first line inside the `HomePage` function body, before the existing `useState` calls:

```typescript
  useIdleDetection()
```

- [ ] **Step 5: Verify both apps build**

Run:
```bash
npm run build --workspace=apps/socket-server
npm run build --workspace=apps/web
```
Expected: both compile with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/presence.ts apps/web/src/lib/useIdleDetection.ts "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: add idle/active presence detection"
```

### Task 4.5: Member list with live presence

**Files:**
- Create: `apps/web/src/app/api/servers/[serverId]/members/route.ts`
- Test: `apps/web/src/app/api/servers/[serverId]/members/route.test.ts`
- Create: `apps/web/src/components/MemberList.tsx`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Consumes: `requireMembership` (existing), `presence:update` (Task 4.3/4.4).
- Produces: `GET /api/servers/:serverId/members` returning `200` with `[{ id, name, image, role, status }]` for every member of the server, `403` if the caller isn't a member. Renders as a new sidebar panel showing live status dots. Task 5.5 (kick button) and Task 5.5's role-gated controls extend this same component.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/servers/[serverId]/members/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/servers/:serverId/members', () => {
  let serverId: string
  let ownerId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['members-owner@example.com', 'members-member@example.com', 'members-outsider@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'members-owner@example.com', name: 'Owner', status: 'ONLINE' } })
    ownerId = owner.id
    const member = await prisma.user.create({ data: { email: 'members-member@example.com', name: 'Member', status: 'OFFLINE' } })

    const server = await prisma.server.create({
      data: {
        name: 'Members Test Server',
        ownerId: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    })
    serverId = server.id
  })

  afterAll(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['members-owner@example.com', 'members-member@example.com', 'members-outsider@example.com'] } } })
  })

  it('lists all members with role and status', async () => {
    mockSession(ownerId)
    const response = await GET(new Request('http://localhost/api/servers/x/members'), {
      params: Promise.resolve({ serverId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    const owner = body.find((m: { name: string }) => m.name === 'Owner')
    expect(owner.role).toBe('OWNER')
    expect(owner.status).toBe('ONLINE')
  })

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.create({ data: { email: 'members-outsider@example.com', name: 'Outsider' } })
    mockSession(outsider.id)

    const response = await GET(new Request('http://localhost/api/servers/x/members'), {
      params: Promise.resolve({ serverId }),
    })

    expect(response.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- members/route.test.ts`
Expected: FAIL — `./route` has no exported member `GET`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/servers/[serverId]/members/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'

export async function GET(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  const memberships = await prisma.membership.findMany({
    where: { serverId },
    include: { user: { select: { id: true, name: true, image: true, status: true } } },
  })

  const members = memberships.map(({ user, role }) => ({
    id: user.id,
    name: user.name,
    image: user.image,
    role,
    status: user.status,
  }))

  return NextResponse.json(members, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- members/route.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 5: Create `apps/web/src/components/MemberList.tsx`**

No automated test — this component's data comes from an already-tested route (Step 3) and already-tested socket broadcasts (Task 4.3/4.4); its own logic is presentation plus subscribing to one event, verified manually (Task 4.6).

```typescript
'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'

type Member = { id: string; name: string | null; image: string | null; role: string; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }

const STATUS_COLOR: Record<Member['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function MemberList({ serverId }: { serverId: string }) {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadMembers() {
      const response = await fetch(`/api/servers/${serverId}/members`)
      if (response.ok && !cancelled) {
        setMembers(await response.json())
      }
    }
    loadMembers()

    const socket = getSocket()
    function handlePresenceUpdate({ userId, status }: { userId: string; status: Member['status'] }) {
      setMembers((prev) => prev.map((member) => (member.id === userId ? { ...member, status } : member)))
    }
    socket.on('presence:update', handlePresenceUpdate)

    return () => {
      cancelled = true
      socket.off('presence:update', handlePresenceUpdate)
    }
  }, [serverId])

  return (
    <aside className="flex w-48 flex-col gap-1 border-l p-3">
      <h3 className="font-bold">Members</h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[member.status]}`} title={member.status} />
            <span>{member.name ?? 'Unknown'}</span>
            {member.role !== 'MEMBER' && <span className="text-xs text-gray-500">({member.role})</span>}
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 6: Render it from the main page**

Modify `apps/web/src/app/(main)/page.tsx`: add the import near the top:

```typescript
import { MemberList } from '@/components/MemberList'
```

Replace the `{selectedChannelId ? (...) : (...)}` block (inside the `activeServer ? (...) : (...)` branch) with:

```typescript
          {selectedChannelId ? (
            <ChatPanel serverId={activeServer.id} channelId={selectedChannelId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a channel</div>
          )}
          <MemberList serverId={activeServer.id} />
```

(This adds one new line — `<MemberList ... />` — as a sibling after the existing conditional, still inside the same `activeServer ? (<>...</>) : (...)` fragment.)

- [ ] **Step 7: Verify the app builds and all tests pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/api/servers/[serverId]/members" apps/web/src/components/MemberList.tsx "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: add member list with live presence indicators"
```

### Task 4.6: Phase 4 manual checkpoint

- [ ] **Step 1: Start everything** (same as Task 3.9 Step 1, skip if already running)

- [ ] **Step 2: Typing indicator test**

1. Two windows, both logged in as members of the same server, both in the same channel (from Task 3.9's setup, or repeat it).
2. As User A: start typing in the message box (don't send). **Expected: "Someone is typing…" appears in User B's window within ~1 second.**
3. Stop typing and wait 2+ seconds without sending. **Expected: the indicator disappears in User B's window.**
4. As User A: type and send a message. **Expected: the indicator disappears immediately (not after the 2-second delay) and the message appears.**

- [ ] **Step 3: Presence test**

1. Both windows should show a member list with green dots next to both users (both online).
2. Close User A's browser window/tab entirely (not just navigate away).
3. Wait ~10-15 seconds. **Expected: User B's member list updates User A's dot to gray (offline).**
4. Reopen and log back in as User A within the grace period (before step 3's wait completes) on a fresh attempt. **Expected: User A's dot stays green in User B's window the whole time — no flicker.**
5. As User A, leave the tab idle (no mouse/keyboard activity, tab focused) — this takes 5 minutes to trigger by design; to verify faster during testing, temporarily lower `IDLE_TIMEOUT_MS` in `apps/web/src/lib/useIdleDetection.ts` to a few seconds, test, then revert the change before committing anything further (don't commit a lowered timeout).

**Phase 4 checkpoint:** typing and presence are both live across windows, with the flicker-avoidance grace period working as intended. This is the point to stop and verify locally before continuing to Phase 5.

---

## Phase 5: Roles & Permissions Enforcement

**Deliverable:** A Member is blocked (both by the API and in the UI) from deleting channels, kicking members, or deleting others' messages; an Admin/Owner can do all three.

### Task 5.1: Include the caller's role in `GET /api/servers`

**Files:**
- Modify: `apps/web/src/app/api/servers/route.ts`
- Modify: `apps/web/src/app/api/servers/route.test.ts`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Produces: each server object in `GET /api/servers`'s response now includes `role: 'OWNER' | 'ADMIN' | 'MEMBER'` — the caller's own role in that server. Task 5.5's UI uses this to decide which controls to show.

- [ ] **Step 1: Update the existing test's expectations**

Modify `apps/web/src/app/api/servers/route.test.ts`: in the `'lists servers the user belongs to via GET'` test, change:

```typescript
    expect(body.some((s: { name: string }) => s.name === 'Listed Server')).toBe(true)
```

to:

```typescript
    const listed = body.find((s: { name: string }) => s.name === 'Listed Server')
    expect(listed).toBeDefined()
    expect(listed.role).toBe('OWNER')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=apps/web -- api/servers/route.test.ts`
Expected: FAIL — `listed.role` is `undefined` (the current `GET` handler doesn't include role yet).

- [ ] **Step 3: Update the `GET` handler in `apps/web/src/app/api/servers/route.ts`**

Replace the `GET` function's body with:

```typescript
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const servers = await prisma.server.findMany({
    where: { memberships: { some: { userId: session.user.id } } },
    include: {
      channels: true,
      memberships: { where: { userId: session.user.id }, select: { role: true } },
    },
  })

  const withRole = servers.map(({ memberships, ...server }) => ({
    ...server,
    role: memberships[0]?.role ?? 'MEMBER',
  }))

  return NextResponse.json(withRole, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- api/servers/route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Update the client's `Server` type and creation handler**

Modify `apps/web/src/app/(main)/page.tsx`: change the `Server` type alias near the top:

```typescript
type Server = { id: string; name: string; channels: Channel[]; role: 'OWNER' | 'ADMIN' | 'MEMBER' }
```

Change the `onCreated` callback (server creation always makes the creator `OWNER` — this is existing, tested behavior from Phase 2, so hardcoding it here is accurate, not an assumption):

```typescript
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, channels: [], role: 'OWNER' }])
          setActiveServerId(server.id)
        }}
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully" (the `Server` type change must not have broken any other usage — if it does, the build will show exactly where).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/servers/route.ts apps/web/src/app/api/servers/route.test.ts "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: include caller's role in server list response"
```

### Task 5.2: Delete channel API

**Files:**
- Create: `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/route.ts`
- Test: `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/route.test.ts`

**Interfaces:**
- Consumes: `requireMembership` (existing), `canDeleteChannel` from `@repo/permissions` (existing, previously unused).
- Produces: `DELETE /api/servers/:serverId/channels/:channelId` returning `200` on success, `403` if the caller's role fails `canDeleteChannel`, `404` if the channel doesn't belong to the server.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { DELETE } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('DELETE /api/servers/:serverId/channels/:channelId', () => {
  let serverId: string
  let channelId: string
  let ownerId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['delchan-owner@example.com', 'delchan-member@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'delchan-owner@example.com', name: 'Owner' } })
    ownerId = owner.id
    const member = await prisma.user.create({ data: { email: 'delchan-member@example.com', name: 'Member' } })
    memberId = member.id

    const server = await prisma.server.create({
      data: {
        name: 'Delete Channel Server',
        ownerId: owner.id,
        memberships: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: member.id, role: 'MEMBER' }] },
      },
    })
    serverId = server.id

    const channel = await prisma.channel.create({ data: { name: 'to-delete', serverId } })
    channelId = channel.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.channel.deleteMany({})
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['delchan-owner@example.com', 'delchan-member@example.com'] } } })
  })

  it('lets an OWNER delete a channel', async () => {
    mockSession(ownerId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(200)
    const found = await prisma.channel.findUnique({ where: { id: channelId } })
    expect(found).toBeNull()
  })

  it('blocks a MEMBER from deleting a channel', async () => {
    mockSession(memberId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, channelId }),
    })

    expect(response.status).toBe(403)
    const found = await prisma.channel.findUnique({ where: { id: channelId } })
    expect(found).not.toBeNull()
  })

  it('returns 404 for a channel that does not belong to the server', async () => {
    mockSession(ownerId)
    const otherServer = await prisma.server.create({
      data: { name: 'Other', ownerId, memberships: { create: { userId: ownerId, role: 'OWNER' } } },
    })

    const response = await DELETE(new Request('http://localhost/api/servers/x/channels/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId: otherServer.id, channelId }),
    })

    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- "servers/\[serverId\]/channels/\[channelId\]/route.test.ts"`
Expected: FAIL — `./route` has no exported member `DELETE`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { canDeleteChannel } from '@repo/permissions'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
) {
  const { serverId, channelId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (!canDeleteChannel(result.membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const channel = await prisma.channel.findFirst({ where: { id: channelId, serverId } })
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  await prisma.channel.delete({ where: { id: channelId } })

  return NextResponse.json({ deleted: true }, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- "servers/\[serverId\]/channels/\[channelId\]/route.test.ts"`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/servers/[serverId]/channels/[channelId]"
git commit -m "feat: add delete channel API with role enforcement"
```

### Task 5.3: Kick member API

**Files:**
- Create: `apps/web/src/app/api/servers/[serverId]/members/[userId]/route.ts`
- Test: `apps/web/src/app/api/servers/[serverId]/members/[userId]/route.test.ts`

**Interfaces:**
- Consumes: `requireMembership` (existing), `canKickMember` from `@repo/permissions` (existing, previously unused).
- Produces: `DELETE /api/servers/:serverId/members/:userId` returning `200` on success, `403` if the caller's role fails `canKickMember` OR if the target is the server's `OWNER` (an owner can never be kicked — matches the same "owner is untouchable" rule Phase 2's fix wave already established for leaving), `404` if the target isn't a member.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/servers/[serverId]/members/[userId]/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { DELETE } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('DELETE /api/servers/:serverId/members/:userId', () => {
  let serverId: string
  let ownerId: string
  let adminId: string
  let memberId: string

  beforeEach(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['kick-owner@example.com', 'kick-admin@example.com', 'kick-member@example.com'] } } })

    const owner = await prisma.user.create({ data: { email: 'kick-owner@example.com', name: 'Owner' } })
    ownerId = owner.id
    const admin = await prisma.user.create({ data: { email: 'kick-admin@example.com', name: 'Admin' } })
    adminId = admin.id
    const member = await prisma.user.create({ data: { email: 'kick-member@example.com', name: 'Member' } })
    memberId = member.id

    const server = await prisma.server.create({
      data: {
        name: 'Kick Test Server',
        ownerId: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: admin.id, role: 'ADMIN' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    })
    serverId = server.id
  })

  afterAll(async () => {
    await prisma.membership.deleteMany({})
    await prisma.server.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['kick-owner@example.com', 'kick-admin@example.com', 'kick-member@example.com'] } } })
  })

  it('lets an ADMIN kick a MEMBER', async () => {
    mockSession(adminId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: memberId }),
    })

    expect(response.status).toBe(200)
    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: memberId, serverId } } })
    expect(membership).toBeNull()
  })

  it('blocks a MEMBER from kicking anyone', async () => {
    mockSession(memberId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: adminId }),
    })

    expect(response.status).toBe(403)
  })

  it('blocks kicking the OWNER, even by another ADMIN', async () => {
    mockSession(adminId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: ownerId }),
    })

    expect(response.status).toBe(403)
    const membership = await prisma.membership.findUnique({ where: { userId_serverId: { userId: ownerId, serverId } } })
    expect(membership?.role).toBe('OWNER')
  })

  it('returns 404 when the target is not a member', async () => {
    mockSession(ownerId)
    const response = await DELETE(new Request('http://localhost/api/servers/x/members/y', { method: 'DELETE' }), {
      params: Promise.resolve({ serverId, userId: 'nonexistent-user-id' }),
    })

    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- "servers/\[serverId\]/members/\[userId\]/route.test.ts"`
Expected: FAIL — `./route` has no exported member `DELETE`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/servers/[serverId]/members/[userId]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { canKickMember } from '@repo/permissions'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  const { serverId, userId: targetUserId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (!canKickMember(result.membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const targetMembership = await prisma.membership.findUnique({
    where: { userId_serverId: { userId: targetUserId, serverId } },
  })
  if (!targetMembership) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (targetMembership.role === 'OWNER') {
    return NextResponse.json({ error: 'The server owner cannot be kicked' }, { status: 403 })
  }

  await prisma.membership.delete({ where: { userId_serverId: { userId: targetUserId, serverId } } })

  return NextResponse.json({ kicked: true }, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- "servers/\[serverId\]/members/\[userId\]/route.test.ts"`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/servers/[serverId]/members/[userId]"
git commit -m "feat: add kick member API with role enforcement"
```

### Task 5.4: `message:delete` socket handler

**Files:**
- Modify: `apps/socket-server/package.json` (add `@repo/permissions` dependency)
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/messages.ts`
- Modify: `apps/socket-server/src/index.ts`

**Interfaces:**
- Consumes: `canDeleteMessage` from `@repo/permissions` (new dependency for this workspace), `getServerMembership` (Task 3.4).
- Produces: `message:delete` — client emits `{ channelId, messageId }`; server checks the message exists, belongs to the channel, and the caller either authored it or has a role that passes `canDeleteMessage`; on success, deletes the row and broadcasts `message:delete` (`{ channelId, messageId }`) to the room so all clients remove it from their view.

- [ ] **Step 1: Add `@repo/permissions` to `apps/socket-server`**

Add this line to `apps/socket-server/package.json`'s `"dependencies"` (alongside `@repo/database`):

```json
    "@repo/permissions": "*",
```

Run: `npm install`
Expected: completes with no errors.

- [ ] **Step 2: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s `ClientToServerEvents` and `ServerToClientEvents` interfaces (leave everything else in the file — `SocketData`, `MessagePayload`, `TypingPayload`, `PresenceStatus`, `PresencePayload`, the `Typed*` exports — unchanged) with:

```typescript
export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'message:delete': (
    payload: { channelId: string; messageId: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'typing:start': (payload: { channelId: string }) => void
  'typing:stop': (payload: { channelId: string }) => void
  'presence:idle': () => void
  'presence:active': () => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'message:delete': (payload: { channelId: string; messageId: string }) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
  'presence:update': (payload: PresencePayload) => void
}
```

- [ ] **Step 3: Add the handler to `apps/socket-server/src/messages.ts`**

Add this import at the top of the file, alongside the existing ones:

```typescript
import { canDeleteMessage } from '@repo/permissions'
```

Add this block inside `registerMessageHandlers`, after the existing `socket.on('message:new', ...)` block:

```typescript
  socket.on('message:delete', async ({ channelId, messageId }, ack) => {
    const membership = await getServerMembership(socket.data.userId, channelId)
    if (!membership) {
      ack({ ok: false, error: 'Not a member of this channel\'s server' })
      return
    }

    const message = await prisma.message.findFirst({ where: { id: messageId, channelId } })
    if (!message) {
      ack({ ok: false, error: 'Message not found' })
      return
    }

    const isOwnMessage = message.authorId === socket.data.userId
    if (!canDeleteMessage(membership.role, isOwnMessage)) {
      ack({ ok: false, error: 'Insufficient permissions' })
      return
    }

    await prisma.message.delete({ where: { id: messageId } })

    io.to(channelRoom(channelId)).emit('message:delete', { channelId, messageId })
    ack({ ok: true })
  })
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/package.json package-lock.json apps/socket-server/src/types.ts apps/socket-server/src/messages.ts
git commit -m "feat: add message:delete socket handler with role enforcement"
```

### Task 5.5: Role-gated UI controls

**Files:**
- Modify: `apps/web/src/components/ChannelList.tsx`
- Modify: `apps/web/src/components/MemberList.tsx`
- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Consumes: `role` on each server (Task 5.1), `canDeleteChannel`/`canKickMember`/`canDeleteMessage` from `@repo/permissions` (already a dependency of `apps/web` since Phase 2).
- Produces: delete-channel, kick-member, and delete-message controls that only render for callers whose role passes the corresponding permission check — a Member never sees a control they'd get a 403 from, an Admin/Owner does.

- [ ] **Step 1: Add a delete-channel button to `ChannelList`**

Replace `apps/web/src/components/ChannelList.tsx`'s contents with:

```typescript
'use client'

import { useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canDeleteChannel, type Role } from '@repo/permissions'

type Channel = { id: string; name: string }

export function ChannelList({
  serverId,
  role,
  channels,
  selectedChannelId,
  onSelectChannel,
  onChannelsChanged,
}: {
  serverId: string
  role: Role
  channels: Channel[]
  selectedChannelId: string | null
  onSelectChannel: (channelId: string) => void
  onChannelsChanged: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function createChannel() {
    if (!name.trim()) return
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setName('')
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  async function deleteChannel(channelId: string) {
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels/${channelId}`, { method: 'DELETE' })
    if (response.ok) {
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex w-52 flex-col gap-2 border-r p-3">
      <h3 className="font-bold"># Channels</h3>
      <ul className="flex flex-col gap-1">
        {channels.map((channel) => (
          <li key={channel.id} className="flex items-center gap-1">
            <button
              onClick={() => onSelectChannel(channel.id)}
              className={`w-full rounded p-1 text-left text-sm ${selectedChannelId === channel.id ? 'bg-indigo-100' : ''}`}
            >
              # {channel.name}
            </button>
            {canDeleteChannel(role) && (
              <button
                onClick={() => deleteChannel(channel.id)}
                className="rounded border p-1 text-xs whitespace-nowrap"
                title="Delete channel"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex flex-col gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New channel name" className="rounded border p-1 text-sm" />
        <button onClick={createChannel} className="rounded border p-1 text-sm">Create channel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add a kick button to `MemberList`**

Replace `apps/web/src/components/MemberList.tsx`'s contents with:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canKickMember, type Role } from '@repo/permissions'

type Member = { id: string; name: string | null; image: string | null; role: Role; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }

const STATUS_COLOR: Record<Member['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function MemberList({ serverId, role }: { serverId: string; role: Role }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')

  async function loadMembers() {
    const response = await fetch(`/api/servers/${serverId}/members`)
    if (response.ok) {
      setMembers(await response.json())
    }
  }

  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      const response = await fetch(`/api/servers/${serverId}/members`)
      if (response.ok && !cancelled) {
        setMembers(await response.json())
      }
    }
    initialLoad()

    const socket = getSocket()
    function handlePresenceUpdate({ userId, status }: { userId: string; status: Member['status'] }) {
      setMembers((prev) => prev.map((member) => (member.id === userId ? { ...member, status } : member)))
    }
    socket.on('presence:update', handlePresenceUpdate)

    return () => {
      cancelled = true
      socket.off('presence:update', handlePresenceUpdate)
    }
  }, [serverId])

  async function kickMember(memberId: string) {
    setError('')
    const response = await fetch(`/api/servers/${serverId}/members/${memberId}`, { method: 'DELETE' })
    if (response.ok) {
      loadMembers()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <aside className="flex w-48 flex-col gap-1 border-l p-3">
      <h3 className="font-bold">Members</h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[member.status]}`} title={member.status} />
            <span>{member.name ?? 'Unknown'}</span>
            {member.role !== 'MEMBER' && <span className="text-xs text-gray-500">({member.role})</span>}
            {canKickMember(role) && member.role !== 'OWNER' && (
              <button onClick={() => kickMember(member.id)} className="ml-auto rounded border p-1 text-xs" title="Kick member">
                Kick
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </aside>
  )
}
```

- [ ] **Step 3: Add a delete-message control to `ChatPanel`**

Modify `apps/web/src/components/ChatPanel.tsx`: add these imports near the top, alongside the existing ones:

```typescript
import { canDeleteMessage, type Role } from '@repo/permissions'
```

Change the component's prop signature to accept the caller's role and their own user id (needed to compute `isOwnMessage` client-side, matching the socket handler's own `canDeleteMessage(role, isOwnMessage)` check):

```typescript
export function ChatPanel({ serverId, channelId, role, currentUserId }: { serverId: string; channelId: string; role: Role; currentUserId: string }) {
```

Add a `message:delete` handler alongside the existing `handleNewMessage` etc. inside the main `useEffect` — add this function definition:

```typescript
    function handleMessageDeleted({ channelId: eventChannelId, messageId }: { channelId: string; messageId: string }) {
      if (eventChannelId !== channelId) return
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
    }
```

Register and unregister it alongside the other socket listeners (add to the existing `socket.on(...)` group and the cleanup's `socket.off(...)` group):

```typescript
    socket.on('message:delete', handleMessageDeleted)
```

```typescript
      socket.off('message:delete', handleMessageDeleted)
```

Add a `deleteMessage` function near `sendMessage`:

```typescript
  function deleteMessage(messageId: string) {
    getSocket().emit('message:delete', { channelId, messageId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
  }
```

Update the message-rendering block to show a delete button when `canDeleteMessage` allows it:

```typescript
        {messages.map((message) => (
          <div key={message.id} className="mb-2 flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
              <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
              <p>{message.content}</p>
            </div>
            {canDeleteMessage(role, message.author.id === currentUserId) && (
              <button onClick={() => deleteMessage(message.id)} className="text-xs text-gray-400 hover:text-red-500" title="Delete message">
                ✕
              </button>
            )}
          </div>
        ))}
```

(This replaces the existing `{messages.map((message) => (<div key={message.id} className="mb-2">...))}` block from Tasks 3.8/4.2 — same data, restructured to a flex row with the conditional delete button.)

- [ ] **Step 4: Pass `role` and `currentUserId` down from the page**

Modify `apps/web/src/app/(main)/page.tsx`.

Add this import near the top:

```typescript
import { useSession } from 'next-auth/react'
```

Add this line inside the `HomePage` function body, alongside the existing `useState` calls:

```typescript
  const { data: session } = useSession()
```

Update the `ChannelList` element to pass `role`:

```typescript
          <ChannelList
            serverId={activeServer.id}
            role={activeServer.role}
            channels={activeServer.channels}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            onChannelsChanged={loadServers}
          />
```

Update the `ChatPanel` element to pass `role` and `currentUserId`:

```typescript
          {selectedChannelId && session?.user?.id ? (
            <ChatPanel serverId={activeServer.id} channelId={selectedChannelId} role={activeServer.role} currentUserId={session.user.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a channel</div>
          )}
```

Update the `MemberList` element to pass `role`:

```typescript
          <MemberList serverId={activeServer.id} role={activeServer.role} />
```

- [ ] **Step 5: Verify the app builds and all tests pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build succeeds; all tests pass (this task only changed UI conditionals and prop plumbing, not API behavior, so no existing test should need updating).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ChannelList.tsx apps/web/src/components/MemberList.tsx apps/web/src/components/ChatPanel.tsx "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: add role-gated UI controls for channel/member/message management"
```

### Task 5.6: Phase 5 manual checkpoint

- [ ] **Step 1: Start everything** (same as Task 3.9 Step 1, skip if already running)

- [ ] **Step 2: Member (should be blocked) test**

1. Log in as a user who is a `MEMBER` (not `OWNER`/`ADMIN`) of a server (join one with a second account if you don't have one).
2. In the channel list: **expected — no "Delete" button next to any channel.**
3. In the member list: **expected — no "Kick" button next to any member.**
4. Send a message, then look at your own message: **expected — a delete (✕) control IS visible on your own message** (any role can delete their own), but not on other users' messages.
5. Confirm the underlying protection isn't just UI: with browser devtools open, run `fetch('/api/servers/<serverId>/channels/<channelId>', { method: 'DELETE' })` from the console while logged in as this Member. **Expected: `403`.**

- [ ] **Step 3: Owner/Admin (should be allowed) test**

1. Log in as the `OWNER` (or promote a test account to `ADMIN` directly in the database for this check, since there's no promote-to-admin UI/API in this plan's scope — that's a reasonable Phase 6+ addition, not required here).
2. **Expected:** "Delete" buttons appear next to channels, "Kick" buttons appear next to members (except the Owner's own row), delete controls appear on every message, not just your own.
3. Delete a channel. **Expected: it disappears from the channel list immediately (and for a second window watching the same server, once they refresh — this plan doesn't add real-time channel-list updates, only real-time chat/presence, which matches the design spec's Phase 3-5 scope).**
4. Kick the Member account from Step 2. **Expected: their next `GET /api/servers` call no longer includes this server; if they still have the page open, their view of it will look stale until they reload or try an action that 403s — again, no real-time membership-list sync is in this plan's scope.**

**Phase 5 checkpoint:** role enforcement holds both in the UI and at the API boundary, for channel deletion, member kicking, and message deletion. This completes the deliverable this plan document covers.

---

## Self-Review Notes

- **Spec coverage (Phase 3-5 rows of the design spec's phase table):** real-time text chat core ✓ (socket-server JWT/JWE handshake auth, join room, send/receive, history load — Tasks 3.1-3.9), presence + typing ✓ (Tasks 4.1-4.6), roles & permissions enforcement ✓ (channel delete, member kick, message delete — Tasks 5.1-5.6, consuming the three previously-unused `@repo/permissions` functions). Voice/video, message edit history, reactions/threads, DMs, friends, and attachments remain correctly out of scope — deferred to the Phase 6-9 plan document per the original project plan's stated structure, not gaps in this one.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable commands or complete code; every socket event handler and REST route shown in full, not summarized.
- **Type consistency:** `MessagePayload` (Task 3.5) is used identically by the history endpoint (Task 3.6) and `ChatPanel` (Task 3.8) — same field names, same nested `author` shape. `TypingPayload`/`PresencePayload`/`PresenceStatus` (Tasks 4.1/4.3) are threaded consistently between `apps/socket-server/src/types.ts` and the client components that consume them (`ChatPanel`, `MemberList`) via matching inline type literals (the two workspaces don't share a types package — each side's shape is kept in sync by this plan's Interfaces blocks, the same cross-task contract mechanism the Phase 0-2 plan used throughout). `Role` from `@repo/permissions` is used consistently as the type for `role` props across `ChannelList`, `MemberList`, and `ChatPanel` (Task 5.5) and matches the `role` field's value produced by Task 5.1's `GET /api/servers` change (Prisma's generated `Role` enum values are the same string literals `@repo/permissions`'s `Role` type union expects — this compatibility was already established and reviewed in the Phase 0-2 plan). `requireMembership`'s `{ userId, membership } | { error }` discriminated union (established in the Phase 0-2 branch's post-review fix wave) is reused as-is by every new route in this plan (Tasks 3.6, 4.5, 5.2, 5.3) with no shape changes needed.
- **Cross-task file-modification consistency:** `apps/socket-server/src/types.ts` is rewritten in full by Tasks 3.3, 3.4, 3.5, 4.1, 4.3, 4.4 (partial — `ClientToServerEvents` only), and 5.4 (partial — both event interfaces only) — each task's version was checked against the previous task's version to confirm it's a strict superset (nothing dropped), and the final Task 5.4 version is the complete, final shape of the file. `apps/web/src/app/(main)/page.tsx` is rewritten in full by Task 3.8, then incrementally modified by Tasks 4.4, 4.5, and 5.1/5.5 — each modification step shows the exact block being changed against the immediately-prior task's version of the file, not against Task 3.8's original in isolation.
