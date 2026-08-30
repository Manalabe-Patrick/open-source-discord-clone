# Discord Clone Phase 6-8 Implementation Plan: Direct Messages, Friends, Attachments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1:1 direct messages, a friend request system, and image attachments (avatars, server icons, message images via Supabase Storage) on top of the completed Phase 0-5 foundation (auth, servers/channels, real-time chat, presence, roles).

**Architecture:** DMs reuse the exact same `apps/socket-server` pattern established in Phase 3 (persist via Prisma, broadcast via Socket.IO room) but as parallel, separate handler modules (`dms.ts`) rather than widening the existing `channels.ts`/`messages.ts` — this keeps already-shipped, already-reviewed Phase 3-5 code untouched. DM rooms are named from a **deterministic sorted pair of user IDs**, not a conversation ID — this lets both participants join the room before any `DmConversation` database row exists (since conversations are created lazily on first message, per the original design spec), avoiding a race where the second participant misses the first live message. Friends is REST-only (no new real-time events — the original design spec's real-time event list only covers channels/DMs/messages/typing/presence, not friend requests, so this stays a deliberate scope boundary, not a gap). Attachments upload through `apps/web` API routes to Supabase Storage using a server-side service-role client (the key never reaches the browser); the resulting public URL is stored on `User.image` / `Server.icon` / `Message.attachmentUrl` and, for messages, passed to the existing socket send events as a new optional field.

**Tech Stack:** Everything from Phase 0-5, plus `@supabase/supabase-js` (new, in `apps/web` only) for Storage uploads.

**Explicitly out of scope for this plan:** Phase 9 (deployment to Vercel/Railway/Supabase-hosted-Postgres) — the user will handle deployment directly once this phase is complete and verified locally. Nothing in this plan assumes a deployed environment; all manual checkpoints run against the local Docker Postgres and local dev servers, same as every prior phase.

## Global Constraints

(Carried over from Phase 0-5, still binding, plus new ones for this phase.)

- Real-time transport is Socket.IO via `apps/socket-server`, with the same JWT/JWE session-cookie auth middleware and `safeHandler` crash-hardening wrapper established in Phase 3-5 — every new socket event handler added in this plan MUST be wrapped in `safeHandler(...)`, no exceptions.
- Database is Postgres via the local Docker Compose container in dev; `apps/web`'s Vitest suite runs against the dedicated `discord_clone_test` database with `fileParallelism: false` (already configured); `apps/socket-server`'s Vitest suite does the same.
- **DM conversations are created lazily on the first message, never on friend-request acceptance** — this is verbatim from the original design spec and directly shapes Task 6.4's design (a DM's `dm:join` never creates a database row; only `dm:message:new` does, via find-or-create).
- **Model naming deviates slightly from the original design spec's prose**: the spec refers to `DMConversation`/`DMParticipant`; this plan uses `DmConversation`/`DmParticipant` (only the "M" is lowercased). Reason: Prisma's client-property casing only lowercases a model name's first character, so `DMConversation` would generate the awkward accessor `prisma.dMConversation`; `DmConversation` generates the natural `prisma.dmConversation`. Purely a naming ergonomics fix, no behavioral difference.
- **No database-level CHECK constraint enforcing "exactly one of `Message.channelId`/`dmConversationId` is set."** Prisma has no schema-level syntax for arbitrary CHECK constraints, and adding one via raw SQL would be the first hand-edited migration in this project. Instead, correctness is enforced by construction: `apps/socket-server/src/messages.ts` (channel messages) only ever sets `channelId`, and the new `apps/socket-server/src/dms.ts` (DM messages) only ever sets `dmConversationId` — two disciplined write paths, not user-suppliable ambiguity. Consistent with this project's established minimal-validation style elsewhere (e.g. no DB-level uniqueness constraint on channel names either).
- **1:1 DMs only, no group DMs.** `findDMConversation(userIdA, userIdB)` (Task 6.2) finds a conversation where both users are participants and trusts that's the right one, without also checking the participant count is exactly 2 — this is safe only because nothing in this plan ever creates a conversation with more than 2 participants. If a future phase adds group DMs, that lookup will need to change.
- Friend requests are looked up **by the addressee's email**, not a numeric/generated ID a user would have to be told out-of-band — mirrors how signup/login already work by email, and there's no user-search UI in this plan's scope to look up an arbitrary user ID.
- Supabase Storage uploads are proxied through `apps/web` server-side (the service-role key is never sent to the browser). The bucket is configured **public-read** (not signed URLs) to keep this portfolio-scoped implementation simple — anyone with a URL can view an avatar/icon/attachment, which is an acceptable trade-off for a project with no private-content requirement (matches the "no blocking users" / minimal-permissions scope already established).
- Message image attachments are uploaded via a **separate REST call before sending** (`POST /api/uploads/message-image` returns a URL), not inlined into the Socket.IO `message:new`/`dm:message:new` payload — file upload needs its own progress/error handling and doesn't belong on a WebSocket event. The returned URL is then included as an optional field when the message is actually sent.
- No automated tests for new UI components (`DMPanel.tsx`, `DMSidebar.tsx`, `FriendsPanel.tsx`, upload controls) or for Socket.IO event wiring itself — both are established, already-approved patterns from Phase 3-5 (component-level UI and socket wiring are verified manually per phase; the pure logic each depends on — DB helpers, REST routes — is unit/integration tested).

---

## Phase 6: Direct Messages

**Deliverable:** From a server's member list, start a DM with another member; messages arrive live for both participants; reopening the app later shows the conversation in a "Direct Messages" list with history intact.

### Task 6.1: Add `DmConversation`/`DmParticipant` models, make `Message.channelId` optional

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `DmConversation` (`id`, `createdAt`), `DmParticipant` (`userId`, `dmConversationId`, unique on the pair) models. `Message.channelId` becomes optional (`String?`); `Message.dmConversationId` (optional `String?`) is added alongside it, with a `dmConversation DmConversation?` relation (`onDelete: Cascade`). `User` gets a new `dmParticipations DmParticipant[]` reverse relation.

- [ ] **Step 1: Modify the `Message` model in `packages/database/prisma/schema.prisma`**

Replace the existing `Message` model with:

```prisma
model Message {
  id               String   @id @default(cuid())
  content          String
  authorId         String
  channelId        String?
  dmConversationId String?
  createdAt        DateTime @default(now())

  author         User            @relation(fields: [authorId], references: [id], onDelete: Cascade)
  channel        Channel?        @relation(fields: [channelId], references: [id], onDelete: Cascade)
  dmConversation DmConversation? @relation(fields: [dmConversationId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Add the new models** (append after `Message`)

```prisma
model DmConversation {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  participants DmParticipant[]
  messages     Message[]
}

model DmParticipant {
  id               String @id @default(cuid())
  userId           String
  dmConversationId String

  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  dmConversation DmConversation @relation(fields: [dmConversationId], references: [id], onDelete: Cascade)

  @@unique([userId, dmConversationId])
}
```

- [ ] **Step 3: Add the reverse relation to `User`**

Add this field alongside `memberships`, `ownedServers`, `messages`:

```prisma
  dmParticipations DmParticipant[]
```

- [ ] **Step 4: Regenerate the client and migrate both databases**

Run:
```bash
npm run generate --workspace=packages/database
npm run migrate:dev --workspace=packages/database -- --name add_dm_models
npm run migrate:test --workspace=packages/database
```
Expected: all three succeed. The dev migration prints "Your database is now in sync with your schema"; the test-DB command prints the new migration being applied.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add DmConversation/DmParticipant models, make Message.channelId optional"
```

### Task 6.2: DM lookup/creation helpers + room-naming helper

**Files:**
- Create: `apps/socket-server/src/dms.ts`
- Test: `apps/socket-server/src/dms.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@repo/database`.
- Produces: `dmRoom(userIdA: string, userIdB: string): string` — the deterministic room name (`dm:<sorted-user-id-pair>`) every later task in this phase joins/broadcasts to. `findDMConversation(userIdA, userIdB): Promise<DmConversation | null>` — looks up an existing conversation without creating one (used by `dm:join`, which must never create a database row). `getOrCreateDMConversation(userIdA, userIdB): Promise<DmConversation>` — finds or atomically creates one (used only by `dm:message:new`, the sole path that's allowed to create a conversation).

This file will also hold the `dm:join`/`dm:leave` handler registration (Task 6.3) and the `dm:message:new`/`dm:message:delete` handlers (Tasks 6.4-6.5) — all DM socket logic lives in this one module, mirroring how `channels.ts` holds all channel-room logic.

- [ ] **Step 1: Write the failing tests**

Create `apps/socket-server/src/dms.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/database'
import { dmRoom, findDMConversation, getOrCreateDMConversation } from './dms'

describe('dmRoom', () => {
  it('produces the same room name regardless of argument order', () => {
    expect(dmRoom('user-a', 'user-b')).toBe(dmRoom('user-b', 'user-a'))
  })

  it('produces a stable, prefixed name', () => {
    expect(dmRoom('user-a', 'user-b')).toBe('dm:user-a:user-b')
  })
})

describe('findDMConversation / getOrCreateDMConversation', () => {
  let userAId: string
  let userBId: string
  let userCId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dm-a@example.com', 'dm-b@example.com', 'dm-c@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dm-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dm-b@example.com', name: 'B' } })
    const userC = await prisma.user.create({ data: { email: 'dm-c@example.com', name: 'C' } })
    userAId = userA.id
    userBId = userB.id
    userCId = userC.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dm-a@example.com', 'dm-b@example.com', 'dm-c@example.com'] } } })
  })

  it('findDMConversation returns null when no conversation exists', async () => {
    const result = await findDMConversation(userAId, userBId)
    expect(result).toBeNull()
  })

  it('getOrCreateDMConversation creates a conversation with both participants', async () => {
    const conversation = await getOrCreateDMConversation(userAId, userBId)
    const participants = await prisma.dmParticipant.findMany({ where: { dmConversationId: conversation.id } })

    expect(participants).toHaveLength(2)
    expect(participants.map((p) => p.userId).sort()).toEqual([userAId, userBId].sort())
  })

  it('getOrCreateDMConversation is idempotent (does not create a second conversation)', async () => {
    const first = await getOrCreateDMConversation(userAId, userBId)
    const second = await getOrCreateDMConversation(userAId, userBId)

    expect(second.id).toBe(first.id)
    const count = await prisma.dmConversation.count()
    expect(count).toBe(1)
  })

  it('getOrCreateDMConversation works with arguments in either order', async () => {
    const first = await getOrCreateDMConversation(userAId, userBId)
    const second = await getOrCreateDMConversation(userBId, userAId)

    expect(second.id).toBe(first.id)
  })

  it('findDMConversation finds an existing conversation after it is created', async () => {
    const created = await getOrCreateDMConversation(userAId, userBId)
    const found = await findDMConversation(userAId, userBId)

    expect(found?.id).toBe(created.id)
  })

  it('does not confuse a conversation between A and B with one between A and C', async () => {
    await getOrCreateDMConversation(userAId, userBId)
    const result = await findDMConversation(userAId, userCId)

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/socket-server -- dms.test.ts`
Expected: FAIL — `./dms` has no exported members, because `src/dms.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/socket-server/src/dms.ts`**

```typescript
import { prisma } from '@repo/database'
import type { DmConversation } from '@repo/database'

export function dmRoom(userIdA: string, userIdB: string): string {
  return `dm:${[userIdA, userIdB].sort().join(':')}`
}

export async function findDMConversation(userIdA: string, userIdB: string): Promise<DmConversation | null> {
  return prisma.dmConversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: userIdA } } },
        { participants: { some: { userId: userIdB } } },
      ],
    },
  })
}

export async function getOrCreateDMConversation(userIdA: string, userIdB: string): Promise<DmConversation> {
  const existing = await findDMConversation(userIdA, userIdB)
  if (existing) return existing

  return prisma.dmConversation.create({
    data: {
      participants: {
        create: [{ userId: userIdA }, { userId: userIdB }],
      },
    },
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/socket-server -- dms.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/dms.ts apps/socket-server/src/dms.test.ts
git commit -m "feat: add DM conversation lookup/creation helpers"
```

### Task 6.3: `dm:join` / `dm:leave` socket handlers

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/dms.ts`
- Modify: `apps/socket-server/src/index.ts`

**Interfaces:**
- Consumes: `dmRoom` (Task 6.2), `safeHandler` (existing, from Phase 3-5).
- Produces: `registerDMHandlers(io, socket)` — the pattern Tasks 6.4-6.5 extend with more handlers in the same function. `dm:join` never touches the database (per this plan's Global Constraints — joining doesn't create a conversation); it only validates the target user exists and isn't the caller themselves, then joins the deterministic room.

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s `ClientToServerEvents` and `ServerToClientEvents` interfaces (leave `SocketData`, `MessagePayload`, `TypingPayload`, `PresenceStatus`, `PresencePayload`, `TypedServer`, `TypedSocket` unchanged) with:

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
  'dm:join': (payload: { otherUserId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'dm:leave': (payload: { otherUserId: string }) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'message:delete': (payload: { channelId: string; messageId: string }) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
  'presence:update': (payload: PresencePayload) => void
}
```

- [ ] **Step 2: Add the handlers to `apps/socket-server/src/dms.ts`**

Add these imports at the top of the file, alongside the existing ones:

```typescript
import { prisma } from '@repo/database'
import type { TypedServer, TypedSocket } from './types.js'
import { safeHandler } from './safeHandler.js'
```

(The `prisma` import already exists in this file from Task 6.2 — don't duplicate it, just add the two new ones alongside it.)

Add this function at the bottom of the file:

```typescript
export function registerDMHandlers(_io: TypedServer, socket: TypedSocket) {
  socket.on(
    'dm:join',
    safeHandler(async ({ otherUserId }, ack) => {
      if (otherUserId === socket.data.userId) {
        ack({ ok: false, error: 'Cannot open a DM with yourself' })
        return
      }

      const otherUser = await prisma.user.findUnique({ where: { id: otherUserId } })
      if (!otherUser) {
        ack({ ok: false, error: 'User not found' })
        return
      }

      socket.join(dmRoom(socket.data.userId, otherUserId))
      ack({ ok: true })
    })
  )

  socket.on(
    'dm:leave',
    safeHandler(({ otherUserId }) => {
      socket.leave(dmRoom(socket.data.userId, otherUserId))
    })
  )
}
```

- [ ] **Step 3: Wire it into `createServer()`**

Modify `apps/socket-server/src/index.ts`: add the import alongside the existing handler imports:

```typescript
import { registerDMHandlers } from './dms.js'
```

Update the `io.on('connection', ...)` block to also register DM handlers:

```typescript
  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
    registerMessageHandlers(io, socket)
    registerTypingHandlers(io, socket)
    registerPresenceHandlers(io, socket)
    registerDMHandlers(io, socket)
  })
```

- [ ] **Step 4: Run the full suite and verify the app builds**

Run:
```bash
npm test --workspace=apps/socket-server
npm run build --workspace=apps/socket-server
```
Expected: all tests pass (the `dms.test.ts` suite from Task 6.2 still passes — nothing in this task touches the functions it tests); build compiles with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/dms.ts apps/socket-server/src/index.ts
git commit -m "feat: add dm:join/dm:leave socket handlers"
```

### Task 6.4: `dm:message:new` handler — find-or-create, persist, broadcast

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/dms.ts`

**Interfaces:**
- Consumes: `getOrCreateDMConversation`, `dmRoom` (Task 6.2).
- Produces: `DMMessagePayload` type (`{ id, content, dmConversationId, createdAt, author: { id, name, image } }`) — Task 6.6's history endpoint and Task 6.7's `DMPanel` both use this exact shape. Client sends `{ recipientUserId, content }` — NOT a conversation ID — so the same call works whether this is the first message ever between the two users or the thousandth; the server always resolves the conversation itself.

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s contents with (this is a full-file replacement — every type from Phase 3-5 plus Task 6.3's additions plus this task's new ones):

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

export interface DMMessagePayload {
  id: string
  content: string
  dmConversationId: string
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
  'message:delete': (
    payload: { channelId: string; messageId: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'typing:start': (payload: { channelId: string }) => void
  'typing:stop': (payload: { channelId: string }) => void
  'presence:idle': () => void
  'presence:active': () => void
  'dm:join': (payload: { otherUserId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'dm:leave': (payload: { otherUserId: string }) => void
  'dm:message:new': (
    payload: { recipientUserId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'message:delete': (payload: { channelId: string; messageId: string }) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
  'presence:update': (payload: PresencePayload) => void
  'dm:message:new': (message: DMMessagePayload) => void
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
```

- [ ] **Step 2: Add the handler to `apps/socket-server/src/dms.ts`**

Add this import at the top of the file, alongside the existing ones:

```typescript
import type { DMMessagePayload } from './types.js'
```

Add this handler inside `registerDMHandlers`, after the existing `dm:leave` block:

```typescript
  socket.on(
    'dm:message:new',
    safeHandler(async ({ recipientUserId, content }, ack) => {
      if (recipientUserId === socket.data.userId) {
        ack({ ok: false, error: 'Cannot message yourself' })
        return
      }

      const recipient = await prisma.user.findUnique({ where: { id: recipientUserId } })
      if (!recipient) {
        ack({ ok: false, error: 'User not found' })
        return
      }

      const trimmed = content.trim()
      if (!trimmed) {
        ack({ ok: false, error: 'Message content is required' })
        return
      }

      const conversation = await getOrCreateDMConversation(socket.data.userId, recipientUserId)

      const message = await prisma.message.create({
        data: { content: trimmed, dmConversationId: conversation.id, authorId: socket.data.userId },
        include: { author: { select: { id: true, name: true, image: true } } },
      })

      const payload: DMMessagePayload = {
        id: message.id,
        content: message.content,
        dmConversationId: conversation.id,
        createdAt: message.createdAt.toISOString(),
        author: message.author,
      }

      _io.to(dmRoom(socket.data.userId, recipientUserId)).emit('dm:message:new', payload)
      ack({ ok: true })
    })
  )
```

Note: `registerDMHandlers`'s first parameter is currently named `_io` (underscore-prefixed, from Task 6.3, since it wasn't used yet). It's used now — rename the parameter from `_io` to `io` in the function signature (`export function registerDMHandlers(io: TypedServer, socket: TypedSocket) {`), and update the reference in this new handler from `_io.to(...)` to `io.to(...)` to match.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/dms.ts
git commit -m "feat: add dm:message:new socket handler (find-or-create, persist, broadcast)"
```

### Task 6.5: `dm:message:delete` handler

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/dms.ts`

**Interfaces:**
- Produces: `dm:message:delete` — client emits `{ dmConversationId, messageId }`; only the message's own author may delete it (DMs have no server roles, so `@repo/permissions`'s role-based functions don't apply here — this is a simpler, author-only check).

- [ ] **Step 1: Extend the shared event types**

Replace `apps/socket-server/src/types.ts`'s `ClientToServerEvents` and `ServerToClientEvents` interfaces (leave everything else — `SocketData`, `MessagePayload`, `DMMessagePayload`, `TypingPayload`, `PresenceStatus`, `PresencePayload`, `TypedServer`, `TypedSocket` — unchanged) with:

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
  'dm:join': (payload: { otherUserId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'dm:leave': (payload: { otherUserId: string }) => void
  'dm:message:new': (
    payload: { recipientUserId: string; content: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
  'dm:message:delete': (
    payload: { dmConversationId: string; messageId: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
}

export interface ServerToClientEvents {
  'message:new': (message: MessagePayload) => void
  'message:delete': (payload: { channelId: string; messageId: string }) => void
  'typing:start': (payload: TypingPayload) => void
  'typing:stop': (payload: TypingPayload) => void
  'presence:update': (payload: PresencePayload) => void
  'dm:message:new': (message: DMMessagePayload) => void
  'dm:message:delete': (payload: { dmConversationId: string; messageId: string }) => void
}
```

- [ ] **Step 2: Add the handler to `apps/socket-server/src/dms.ts`**

Add this handler inside `registerDMHandlers`, after the `dm:message:new` block:

```typescript
  socket.on(
    'dm:message:delete',
    safeHandler(async ({ dmConversationId, messageId }, ack) => {
      const message = await prisma.message.findFirst({ where: { id: messageId, dmConversationId } })
      if (!message) {
        ack({ ok: false, error: 'Message not found' })
        return
      }

      if (message.authorId !== socket.data.userId) {
        ack({ ok: false, error: 'You can only delete your own messages' })
        return
      }

      const participant = await prisma.dmParticipant.findUnique({
        where: { userId_dmConversationId: { userId: socket.data.userId, dmConversationId } },
      })
      if (!participant) {
        ack({ ok: false, error: 'Not a participant in this conversation' })
        return
      }

      await prisma.message.delete({ where: { id: messageId } })

      const otherParticipant = await prisma.dmParticipant.findFirst({
        where: { dmConversationId, userId: { not: socket.data.userId } },
      })
      if (otherParticipant) {
        io.to(dmRoom(socket.data.userId, otherParticipant.userId)).emit('dm:message:delete', { dmConversationId, messageId })
      }
      ack({ ok: true })
    })
  )
```

Note: this handler looks up the other participant to compute the exact room name (`dmRoom` needs both user IDs, and the delete payload only carries `dmConversationId`, not the other user's ID) — this is a small extra query the `dm:message:new` handler didn't need, since that one already had `recipientUserId` directly from its payload.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/dms.ts
git commit -m "feat: add dm:message:delete socket handler (author-only)"
```

### Task 6.6: DM list and history REST endpoints

**Files:**
- Create: `apps/web/src/app/api/dms/route.ts`
- Test: `apps/web/src/app/api/dms/route.test.ts`
- Create: `apps/web/src/app/api/dms/[otherUserId]/messages/route.ts`
- Test: `apps/web/src/app/api/dms/[otherUserId]/messages/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth` (existing).
- Produces: `GET /api/dms` returning `200` with `[{ id, otherUser: { id, name, image, status } }]` for every conversation the caller participates in. `GET /api/dms/:otherUserId/messages` returning `200` with an array of messages in `DMMessagePayload` shape (oldest first) for the conversation between the caller and `otherUserId` — **an empty array, not a 404, if no conversation exists yet** (this is what lets the client always fetch "history" for a brand-new DM target without first checking whether a conversation exists).

- [ ] **Step 1: Write the failing tests for the list endpoint**

Create `apps/web/src/app/api/dms/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/dms', () => {
  let userAId: string
  let userBId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmlist-a@example.com', 'dmlist-b@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dmlist-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dmlist-b@example.com', name: 'B', status: 'ONLINE' } })
    userAId = userA.id
    userBId = userB.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmlist-a@example.com', 'dmlist-b@example.com'] } } })
  })

  it('returns 401 when not logged in', async () => {
    ;(auth as unknown as Mock).mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns an empty array when the user has no conversations', async () => {
    mockSession(userAId)
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('lists a conversation with the other participant\'s info', async () => {
    const conversation = await prisma.dmConversation.create({
      data: { participants: { create: [{ userId: userAId }, { userId: userBId }] } },
    })
    mockSession(userAId)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([{ id: conversation.id, otherUser: { id: userBId, name: 'B', image: null, status: 'ONLINE' } }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=apps/web -- api/dms/route.test.ts`
Expected: FAIL — `./route` has no exported member `GET`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/dms/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const conversations = await prisma.dmConversation.findMany({
    where: { participants: { some: { userId: session.user.id } } },
    include: {
      participants: {
        where: { userId: { not: session.user.id } },
        include: { user: { select: { id: true, name: true, image: true, status: true } } },
      },
    },
  })

  const payload = conversations
    .filter((conversation) => conversation.participants.length > 0)
    .map((conversation) => ({
      id: conversation.id,
      otherUser: conversation.participants[0].user,
    }))

  return NextResponse.json(payload, { status: 200 })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/web -- api/dms/route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Write the failing tests for the history endpoint**

Create `apps/web/src/app/api/dms/[otherUserId]/messages/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/dms/:otherUserId/messages', () => {
  let userAId: string
  let userBId: string

  beforeEach(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmhist-a@example.com', 'dmhist-b@example.com'] } } })

    const userA = await prisma.user.create({ data: { email: 'dmhist-a@example.com', name: 'A' } })
    const userB = await prisma.user.create({ data: { email: 'dmhist-b@example.com', name: 'B' } })
    userAId = userA.id
    userBId = userB.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({})
    await prisma.dmParticipant.deleteMany({})
    await prisma.dmConversation.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['dmhist-a@example.com', 'dmhist-b@example.com'] } } })
  })

  it('returns 401 when not logged in', async () => {
    ;(auth as unknown as Mock).mockResolvedValue(null)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    expect(response.status).toBe(401)
  })

  it('returns an empty array when no conversation exists yet', async () => {
    mockSession(userAId)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns messages oldest-first with author info', async () => {
    const conversation = await prisma.dmConversation.create({
      data: { participants: { create: [{ userId: userAId }, { userId: userBId }] } },
    })
    await prisma.message.create({ data: { content: 'hi', dmConversationId: conversation.id, authorId: userAId } })
    await prisma.message.create({ data: { content: 'hello', dmConversationId: conversation.id, authorId: userBId } })

    mockSession(userAId)
    const response = await GET(new Request('http://localhost/api/dms/x/messages'), { params: Promise.resolve({ otherUserId: userBId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].content).toBe('hi')
    expect(body[1].content).toBe('hello')
    expect(body[1].author).toEqual({ id: userBId, name: 'B', image: null })
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test --workspace=apps/web -- api/dms/[otherUserId]/messages/route.test.ts`
Expected: FAIL — `./route` has no exported member `GET`, because `route.ts` doesn't exist yet.

- [ ] **Step 7: Create `apps/web/src/app/api/dms/[otherUserId]/messages/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function GET(_request: Request, { params }: { params: Promise<{ otherUserId: string }> }) {
  const { otherUserId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const conversation = await prisma.dmConversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: session.user.id } } },
        { participants: { some: { userId: otherUserId } } },
      ],
    },
  })

  if (!conversation) {
    return NextResponse.json([], { status: 200 })
  }

  const messages = await prisma.message.findMany({
    where: { dmConversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, image: true } } },
  })

  const payload = messages.map((message) => ({
    id: message.id,
    content: message.content,
    dmConversationId: message.dmConversationId,
    createdAt: message.createdAt.toISOString(),
    author: message.author,
  }))

  return NextResponse.json(payload, { status: 200 })
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test --workspace=apps/web -- api/dms/[otherUserId]/messages/route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/api/dms
git commit -m "feat: add DM list and history REST endpoints"
```

### Task 6.7: `DMPanel` UI component

**Files:**
- Create: `apps/web/src/components/DMPanel.tsx`

**Interfaces:**
- Consumes: `getSocket` (existing), `GET /api/dms/:otherUserId/messages` (Task 6.6), `dm:join`/`dm:leave`/`dm:message:new`/`dm:message:delete` (Tasks 6.3-6.5).
- Produces: the DM equivalent of `ChatPanel` — deliberately a **separate component**, not a shared abstraction with `ChatPanel`, even though the two are structurally similar. `ChatPanel` needs a `role` for permission-gated delete and channel-scoped typing; `DMPanel` has neither (any DM participant can only ever delete their own message — no roles exist in a 1:1 conversation) and this plan doesn't add DM typing indicators (out of scope — the deliverable is "messages arrive live," typing indicators were a Phase 4-specific goal for channels). Forcing a shared component would mean threading unused props through one side or the other for no real benefit at this scope; two small, focused components is simpler here than one configurable one.

No automated test — same reasoning as `ChatPanel.tsx` in Phase 3 (fetch-then-render logic is already covered by Task 6.6's route tests and Task 6.4-6.5's socket-side logic; live end-to-end behavior is verified manually in Task 6.9).

- [ ] **Step 1: Create `apps/web/src/components/DMPanel.tsx`**

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'

type DMMessage = {
  id: string
  content: string
  dmConversationId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

export function DMPanel({ otherUserId, otherUserName, currentUserId }: { otherUserId: string; otherUserName: string | null; currentUserId: string }) {
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const response = await fetch(`/api/dms/${otherUserId}/messages`)
      if (response.ok && !cancelled) {
        const history: DMMessage[] = await response.json()
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id))
          const liveOnly = prev.filter((m) => !historyIds.has(m.id))
          return [...history, ...liveOnly]
        })
      }
    }
    loadHistory()

    const socket = getSocket()
    socket.emit('dm:join', { otherUserId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok && !cancelled) setError(response.error)
    })

    function handleNewMessage(message: DMMessage) {
      setMessages((prev) => [...prev, message])
    }
    function handleMessageDeleted({ messageId }: { dmConversationId: string; messageId: string }) {
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
    }

    socket.on('dm:message:new', handleNewMessage)
    socket.on('dm:message:delete', handleMessageDeleted)

    return () => {
      cancelled = true
      socket.emit('dm:leave', { otherUserId })
      socket.off('dm:message:new', handleNewMessage)
      socket.off('dm:message:delete', handleMessageDeleted)
    }
  }, [otherUserId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) return
    setError('')

    getSocket().emit('dm:message:new', { recipientUserId: otherUserId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
  }

  function deleteMessage(message: DMMessage) {
    getSocket().emit('dm:message:delete', { dmConversationId: message.dmConversationId, messageId: message.id }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b p-3 font-bold">{otherUserName ?? 'Unknown'}</div>
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-2 flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
              <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
              <p>{message.content}</p>
            </div>
            {message.author.id === currentUserId && (
              <button onClick={() => deleteMessage(message)} className="text-xs text-gray-400 hover:text-red-500" title="Delete message">
                ✕
              </button>
            )}
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

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/DMPanel.tsx
git commit -m "feat: add DMPanel UI component"
```

### Task 6.8: `DMSidebar` UI + wire into the app shell

**Files:**
- Create: `apps/web/src/components/DMSidebar.tsx`
- Modify: `apps/web/src/components/ServerSidebar.tsx`
- Modify: `apps/web/src/components/MemberList.tsx`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Consumes: `GET /api/dms` (Task 6.6).
- Produces: a "Direct Messages" nav entry in `ServerSidebar` that switches the main app view from the server/channel layout to a DM list + `DMPanel`; a "Message" button on each `MemberList` row (except the caller's own) that jumps straight into a DM with that member.

- [ ] **Step 1: Create `apps/web/src/components/DMSidebar.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'

type Conversation = { id: string; otherUser: { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' } }

const STATUS_COLOR: Record<Conversation['otherUser']['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function DMSidebar({
  activeOtherUserId,
  onSelect,
  refreshKey,
}: {
  activeOtherUserId: string | null
  onSelect: (otherUserId: string, otherUserName: string | null) => void
  refreshKey: number
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const response = await fetch('/api/dms')
      if (response.ok && !cancelled) {
        setConversations(await response.json())
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <aside className="flex w-60 flex-col gap-2 border-r p-3">
      <h2 className="font-bold">Direct Messages</h2>
      <ul className="flex flex-col gap-1">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              onClick={() => onSelect(conversation.otherUser.id, conversation.otherUser.name)}
              className={`flex w-full items-center gap-2 rounded p-2 text-left ${activeOtherUserId === conversation.otherUser.id ? 'bg-indigo-100' : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[conversation.otherUser.status]}`} />
              {conversation.otherUser.name ?? 'Unknown'}
            </button>
          </li>
        ))}
        {conversations.length === 0 && <p className="text-xs text-gray-500">No conversations yet — message someone from a server&apos;s member list.</p>}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 2: Add a "Direct Messages" nav entry to `ServerSidebar`**

Modify `apps/web/src/components/ServerSidebar.tsx`: add a new prop to the component's signature — `onOpenDMs: () => void` and `dmsActive: boolean` — added to the destructured props alongside the existing ones:

```typescript
export function ServerSidebar({
  servers,
  activeServerId,
  onSelect,
  onCreated,
  onLeft,
  onOpenDMs,
  dmsActive,
}: {
  servers: Server[]
  activeServerId: string | null
  onSelect: (serverId: string) => void
  onCreated: (server: Server) => void
  onLeft: (serverId: string) => void
  onOpenDMs: () => void
  dmsActive: boolean
}) {
```

Add a button right after the existing `<div className="flex items-center justify-between">...</div>` header block (i.e. as a new element between that header and the `<ul>` of servers):

```typescript
      <button
        onClick={onOpenDMs}
        className={`rounded p-2 text-left ${dmsActive ? 'bg-indigo-100' : ''}`}
      >
        Direct Messages
      </button>
```

- [ ] **Step 3: Add a "Message" button to `MemberList`**

Modify `apps/web/src/components/MemberList.tsx`: add a new prop `currentUserId: string` and `onMessageMember: (userId: string, name: string | null) => void` to the component's signature:

```typescript
export function MemberList({ serverId, role, currentUserId, onMessageMember }: { serverId: string; role: Role; currentUserId: string; onMessageMember: (userId: string, name: string | null) => void }) {
```

Add a "Message" button inside the `<li>` for each member, after the existing role-label span and before the conditional Kick button:

```typescript
            {member.id !== currentUserId && (
              <button onClick={() => onMessageMember(member.id, member.name)} className="rounded border p-1 text-xs" title="Send a direct message">
                Message
              </button>
            )}
```

- [ ] **Step 4: Wire everything into `apps/web/src/app/(main)/page.tsx`**

Replace `apps/web/src/app/(main)/page.tsx`'s contents with:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ServerSidebar } from '@/components/ServerSidebar'
import { ChannelList } from '@/components/ChannelList'
import { ChatPanel } from '@/components/ChatPanel'
import { MemberList } from '@/components/MemberList'
import { DMSidebar } from '@/components/DMSidebar'
import { DMPanel } from '@/components/DMPanel'
import { useIdleDetection } from '@/lib/useIdleDetection'

type Channel = { id: string; name: string }
type Server = { id: string; name: string; channels: Channel[]; role: 'OWNER' | 'ADMIN' | 'MEMBER' }

export default function HomePage() {
  useIdleDetection()
  const { data: session } = useSession()
  const [servers, setServers] = useState<Server[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [view, setView] = useState<'server' | 'dm'>('server')
  const [activeDM, setActiveDM] = useState<{ userId: string; name: string | null } | null>(null)
  const [dmRefreshKey, setDmRefreshKey] = useState(0)

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

  function openDM(userId: string, name: string | null) {
    setView('dm')
    setActiveDM({ userId, name })
    setDmRefreshKey((k) => k + 1)
  }

  return (
    <>
      <ServerSidebar
        servers={servers}
        activeServerId={view === 'server' ? activeServerId : null}
        onSelect={(serverId) => {
          setView('server')
          setActiveServerId(serverId)
          setSelectedChannelId(null)
        }}
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, channels: [], role: 'OWNER' }])
          setActiveServerId(server.id)
          setView('server')
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
        onOpenDMs={() => setView('dm')}
        dmsActive={view === 'dm'}
      />
      {view === 'dm' ? (
        <>
          <DMSidebar
            activeOtherUserId={activeDM?.userId ?? null}
            onSelect={(userId, name) => setActiveDM({ userId, name })}
            refreshKey={dmRefreshKey}
          />
          {activeDM && session?.user?.id ? (
            <DMPanel otherUserId={activeDM.userId} otherUserName={activeDM.name} currentUserId={session.user.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a conversation</div>
          )}
        </>
      ) : activeServer ? (
        <>
          <ChannelList
            serverId={activeServer.id}
            role={activeServer.role}
            channels={activeServer.channels}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            onChannelsChanged={loadServers}
          />
          {selectedChannelId && session?.user?.id ? (
            <ChatPanel serverId={activeServer.id} channelId={selectedChannelId} role={activeServer.role} currentUserId={session.user.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a channel</div>
          )}
          {session?.user?.id && (
            <MemberList serverId={activeServer.id} role={activeServer.role} currentUserId={session.user.id} onMessageMember={openDM} />
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">Select or create a server</div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Verify the app builds and all tests pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build succeeds; all tests pass (this task only changed UI conditionals/prop plumbing, not API behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/DMSidebar.tsx apps/web/src/components/ServerSidebar.tsx apps/web/src/components/MemberList.tsx "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: wire direct messages into the app shell"
```

### Task 6.9: Phase 6 manual checkpoint

No real browser is available in this sandbox (established in Phase 3-5) — verify via curl (HTTP+cookie auth) and `socket.io-client` (real Socket.IO protocol), the same pattern used for every Phase 3-5 checkpoint.

- [ ] **Step 1: Start everything**

```bash
docker compose up -d
npm run dev:socket
npm run dev:web
```

- [ ] **Step 2: Two-user DM test**

1. Sign up / log in as User A and User B (via `POST /api/signup` + the Auth.js credentials callback flow, cookie jar per user — see `.superpowers/sdd/task-3.9-report.md` in a prior worktree, or the plan text above, for the exact request sequence if you need a reference).
2. As User A, create a server and have User B join it (so User B appears in `GET /api/servers/:serverId/members`).
3. Connect two `socket.io-client` instances (one per user, `extraHeaders: { Cookie: ... }`).
4. Both `dm:join` with each other's user ID as `otherUserId`. Confirm both acks are `{ ok: true }`.
5. As User A, emit `dm:message:new` with `{ recipientUserId: <User B's id>, content: 'hey' }`. Confirm the ack is `{ ok: true }` and BOTH sockets receive a `dm:message:new` broadcast with matching content (this is the race the deterministic room-naming exists to prevent — confirm User B, who joined before any conversation existed, still gets this first message).
6. Call `GET /api/dms` as User A — confirm it lists one conversation with User B's info. Call `GET /api/dms/<User B's id>/messages` — confirm the message from Step 5 is present.
7. As User B, reply. Confirm both sockets receive it.
8. As User A, delete their own message via `dm:message:delete`. Confirm both sockets receive `dm:message:delete` and the history endpoint no longer includes it.
9. As User B, attempt to delete User A's remaining message. Confirm the ack is `{ ok: false, ... }` and the message still exists via the history endpoint.

- [ ] **Step 3: Stop everything**

Stop both dev servers. Leave Postgres running or `docker compose down`, your choice.

**Phase 6 checkpoint:** direct messages work end-to-end — join, send, receive live (including the no-message-history-yet race case), delete own message, can't delete others'. This is the point to stop and verify locally before continuing to Phase 7.

---

## Phase 7: Friends System

**Deliverable:** Send a friend request by email; the recipient sees it and can accept or decline; both users then see each other in a friends list with a one-click "Message" button that opens a DM.

### Task 7.1: Add the `FriendRequest` model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `FriendRequestStatus` enum (`PENDING`, `ACCEPTED`, `DECLINED`), `FriendRequest` model (`id`, `requesterId`, `addresseeId`, `status`, `createdAt`), unique on `[requesterId, addresseeId]` (a user can only have one outstanding/resolved request to a given person at a time — a declined request isn't automatically re-sendable in this scope; that's a reasonable, disclosed simplification, not a bug).

- [ ] **Step 1: Add the model to `packages/database/prisma/schema.prisma`** (append after `DmParticipant`)

```prisma
enum FriendRequestStatus {
  PENDING
  ACCEPTED
  DECLINED
}

model FriendRequest {
  id          String              @id @default(cuid())
  requesterId String
  addresseeId String
  status      FriendRequestStatus @default(PENDING)
  createdAt   DateTime            @default(now())

  requester User @relation("FriendRequestSent", fields: [requesterId], references: [id], onDelete: Cascade)
  addressee User @relation("FriendRequestReceived", fields: [addresseeId], references: [id], onDelete: Cascade)

  @@unique([requesterId, addresseeId])
}
```

- [ ] **Step 2: Add the reverse relations to `User`**

Add these two fields alongside `dmParticipations`:

```prisma
  sentFriendRequests     FriendRequest[] @relation("FriendRequestSent")
  receivedFriendRequests FriendRequest[] @relation("FriendRequestReceived")
```

- [ ] **Step 3: Regenerate the client and migrate both databases**

Run:
```bash
npm run generate --workspace=packages/database
npm run migrate:dev --workspace=packages/database -- --name add_friend_requests
npm run migrate:test --workspace=packages/database
```
Expected: all three succeed.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add FriendRequest model"
```

### Task 7.2: Send friend request API

**Files:**
- Create: `apps/web/src/app/api/friends/requests/route.ts`
- Test: `apps/web/src/app/api/friends/requests/route.test.ts`

**Interfaces:**
- Consumes: `auth` (existing).
- Produces: `POST /api/friends/requests` accepting `{ email }`, returning `201` with the created request on success. Returns `400` for: missing email, self-friending, target email not found, a request already existing between the two users in either direction (pending, accepted, or declined — this endpoint doesn't distinguish those cases in this scope; re-sending after a decline isn't supported, matching Task 7.1's disclosed simplification), or the two users already being friends (an ACCEPTED request already exists).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/friends/requests/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { POST } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/friends/requests', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/friends/requests', () => {
  let requesterId: string
  let addresseeId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friend-req@example.com', 'friend-addr@example.com'] } } })

    const requester = await prisma.user.create({ data: { email: 'friend-req@example.com', name: 'Requester' } })
    const addressee = await prisma.user.create({ data: { email: 'friend-addr@example.com', name: 'Addressee' } })
    requesterId = requester.id
    addresseeId = addressee.id
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friend-req@example.com', 'friend-addr@example.com'] } } })
  })

  it('creates a pending request', async () => {
    mockSession(requesterId)
    const response = await POST(makeRequest({ email: 'friend-addr@example.com' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.status).toBe('PENDING')
    expect(body.addresseeId).toBe(addresseeId)
  })

  it('rejects sending a request to yourself', async () => {
    mockSession(requesterId)
    const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } })
    const response = await POST(makeRequest({ email: requesterUser!.email }))
    expect(response.status).toBe(400)
  })

  it('rejects a request to an email that does not exist', async () => {
    mockSession(requesterId)
    const response = await POST(makeRequest({ email: 'nobody@example.com' }))
    expect(response.status).toBe(400)
  })

  it('rejects a duplicate request', async () => {
    mockSession(requesterId)
    await POST(makeRequest({ email: 'friend-addr@example.com' }))
    const response = await POST(makeRequest({ email: 'friend-addr@example.com' }))
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- friends/requests/route.test.ts`
Expected: FAIL — `./route` has no exported member `POST`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/friends/requests/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let email: string | undefined
  try {
    ;({ email } = (await request.json()) as { email?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const addressee = await prisma.user.findUnique({ where: { email } })
  if (!addressee) {
    return NextResponse.json({ error: 'No user found with that email' }, { status: 400 })
  }
  if (addressee.id === session.user.id) {
    return NextResponse.json({ error: 'Cannot send a friend request to yourself' }, { status: 400 })
  }

  const existing = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId: addressee.id },
        { requesterId: addressee.id, addresseeId: session.user.id },
      ],
    },
  })
  if (existing) {
    return NextResponse.json({ error: 'A friend request already exists between you and this user' }, { status: 400 })
  }

  const friendRequest = await prisma.friendRequest.create({
    data: { requesterId: session.user.id, addresseeId: addressee.id },
  })

  return NextResponse.json(friendRequest, { status: 201 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- friends/requests/route.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/friends/requests/route.ts apps/web/src/app/api/friends/requests/route.test.ts
git commit -m "feat: add send friend request API"
```

### Task 7.3: Accept / decline friend request API

**Files:**
- Create: `apps/web/src/app/api/friends/requests/[requestId]/route.ts`
- Test: `apps/web/src/app/api/friends/requests/[requestId]/route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/friends/requests/:requestId` accepting `{ action: 'accept' | 'decline' }`. Only the **addressee** may act on a request (the requester cannot accept their own request). Returns `200` with the updated request on success, `403` if the caller isn't the addressee, `404` if the request doesn't exist, `400` if the request isn't `PENDING` (already resolved) or `action` is invalid.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/friends/requests/[requestId]/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { PATCH } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

function makeRequest(action: string) {
  return new Request('http://localhost/api/friends/requests/x', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PATCH /api/friends/requests/:requestId', () => {
  let requesterId: string
  let addresseeId: string
  let requestId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['patch-req@example.com', 'patch-addr@example.com'] } } })

    const requester = await prisma.user.create({ data: { email: 'patch-req@example.com', name: 'Requester' } })
    const addressee = await prisma.user.create({ data: { email: 'patch-addr@example.com', name: 'Addressee' } })
    requesterId = requester.id
    addresseeId = addressee.id

    const friendRequest = await prisma.friendRequest.create({ data: { requesterId, addresseeId } })
    requestId = friendRequest.id
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['patch-req@example.com', 'patch-addr@example.com'] } } })
  })

  it('lets the addressee accept', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ACCEPTED')
  })

  it('lets the addressee decline', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('decline'), { params: Promise.resolve({ requestId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('DECLINED')
  })

  it('blocks the requester from acting on their own request', async () => {
    mockSession(requesterId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    expect(response.status).toBe(403)
  })

  it('returns 404 for a nonexistent request', async () => {
    mockSession(addresseeId)
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId: 'nonexistent' }) })
    expect(response.status).toBe(404)
  })

  it('returns 400 for an already-resolved request', async () => {
    mockSession(addresseeId)
    await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    const response = await PATCH(makeRequest('accept'), { params: Promise.resolve({ requestId }) })
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/web -- "friends/requests/\[requestId\]/route.test.ts"`
Expected: FAIL — `./route` has no exported member `PATCH`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/friends/requests/[requestId]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let action: string | undefined
  try {
    ;({ action } = (await request.json()) as { action?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be "accept" or "decline"' }, { status: 400 })
  }

  const friendRequest = await prisma.friendRequest.findUnique({ where: { id: requestId } })
  if (!friendRequest) {
    return NextResponse.json({ error: 'Friend request not found' }, { status: 404 })
  }

  if (friendRequest.addresseeId !== session.user.id) {
    return NextResponse.json({ error: 'Only the addressee can respond to this request' }, { status: 403 })
  }

  if (friendRequest.status !== 'PENDING') {
    return NextResponse.json({ error: 'This request has already been resolved' }, { status: 400 })
  }

  const updated = await prisma.friendRequest.update({
    where: { id: requestId },
    data: { status: action === 'accept' ? 'ACCEPTED' : 'DECLINED' },
  })

  return NextResponse.json(updated, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/web -- "friends/requests/\[requestId\]/route.test.ts"`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/friends/requests/[requestId]"
git commit -m "feat: add accept/decline friend request API"
```

### Task 7.4: List friends and pending requests API

**Files:**
- Create: `apps/web/src/app/api/friends/route.ts`
- Test: `apps/web/src/app/api/friends/route.test.ts`

**Interfaces:**
- Produces: `GET /api/friends` returning `200` with `{ friends: [{ id, name, image, status }], incoming: [{ id, requester: {...} }], outgoing: [{ id, addressee: {...} }] }` — friends (accepted, either direction), incoming pending requests (I'm the addressee), outgoing pending requests (I'm the requester) in one combined response, since the friends UI (Task 7.5) needs all three lists at once and there's no reason to make three round-trips for one panel.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/friends/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'
import { prisma } from '@repo/database'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
import { auth } from '@/lib/auth'

const mockSession = (userId: string) => {
  ;(auth as unknown as Mock).mockResolvedValue({ user: { id: userId }, expires: '' })
}

describe('GET /api/friends', () => {
  let meId: string
  let friendId: string
  let incomingRequesterId: string
  let outgoingAddresseeId: string

  beforeEach(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friends-me@example.com', 'friends-friend@example.com', 'friends-incoming@example.com', 'friends-outgoing@example.com'] } } })

    const me = await prisma.user.create({ data: { email: 'friends-me@example.com', name: 'Me' } })
    const friend = await prisma.user.create({ data: { email: 'friends-friend@example.com', name: 'Friend', status: 'ONLINE' } })
    const incomingRequester = await prisma.user.create({ data: { email: 'friends-incoming@example.com', name: 'Incoming' } })
    const outgoingAddressee = await prisma.user.create({ data: { email: 'friends-outgoing@example.com', name: 'Outgoing' } })
    meId = me.id
    friendId = friend.id
    incomingRequesterId = incomingRequester.id
    outgoingAddresseeId = outgoingAddressee.id

    await prisma.friendRequest.create({ data: { requesterId: meId, addresseeId: friendId, status: 'ACCEPTED' } })
    await prisma.friendRequest.create({ data: { requesterId: incomingRequesterId, addresseeId: meId, status: 'PENDING' } })
    await prisma.friendRequest.create({ data: { requesterId: meId, addresseeId: outgoingAddresseeId, status: 'PENDING' } })
  })

  afterAll(async () => {
    await prisma.friendRequest.deleteMany({})
    await prisma.user.deleteMany({ where: { email: { in: ['friends-me@example.com', 'friends-friend@example.com', 'friends-incoming@example.com', 'friends-outgoing@example.com'] } } })
  })

  it('lists friends, incoming, and outgoing requests', async () => {
    mockSession(meId)
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.friends).toEqual([{ id: friendId, name: 'Friend', image: null, status: 'ONLINE' }])
    expect(body.incoming).toHaveLength(1)
    expect(body.incoming[0].requester.id).toBe(incomingRequesterId)
    expect(body.outgoing).toHaveLength(1)
    expect(body.outgoing[0].addressee.id).toBe(outgoingAddresseeId)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=apps/web -- api/friends/route.test.ts`
Expected: FAIL — `./route` has no exported member `GET`, because `route.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/app/api/friends/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'

const userSelect = { id: true, name: true, image: true, status: true } as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const accepted = await prisma.friendRequest.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: { requester: { select: userSelect }, addressee: { select: userSelect } },
  })
  const friends = accepted.map((request) => (request.requesterId === userId ? request.addressee : request.requester))

  const incoming = await prisma.friendRequest.findMany({
    where: { status: 'PENDING', addresseeId: userId },
    include: { requester: { select: userSelect } },
  })

  const outgoing = await prisma.friendRequest.findMany({
    where: { status: 'PENDING', requesterId: userId },
    include: { addressee: { select: userSelect } },
  })

  return NextResponse.json(
    {
      friends,
      incoming: incoming.map((r) => ({ id: r.id, requester: r.requester })),
      outgoing: outgoing.map((r) => ({ id: r.id, addressee: r.addressee })),
    },
    { status: 200 }
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/web -- api/friends/route.test.ts`
Expected: PASS — the test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/friends/route.ts apps/web/src/app/api/friends/route.test.ts
git commit -m "feat: add list friends/requests API"
```

### Task 7.5: `FriendsPanel` UI component

**Files:**
- Create: `apps/web/src/components/FriendsPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/friends` (Task 7.4), `POST /api/friends/requests` (Task 7.2), `PATCH /api/friends/requests/:requestId` (Task 7.3).
- Produces: send-by-email form, incoming requests with accept/decline, outgoing requests (pending, no action), friends list with a "Message" button wired to the same DM-opening callback `MemberList` already uses.

No automated test — established UI-component pattern.

- [ ] **Step 1: Create `apps/web/src/components/FriendsPanel.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type UserInfo = { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }
type FriendsData = {
  friends: UserInfo[]
  incoming: { id: string; requester: UserInfo }[]
  outgoing: { id: string; addressee: UserInfo }[]
}

const STATUS_COLOR: Record<UserInfo['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function FriendsPanel({ onMessageFriend }: { onMessageFriend: (userId: string, name: string | null) => void }) {
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] })
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  async function loadFriends() {
    const response = await fetch('/api/friends')
    if (response.ok) {
      setData(await response.json())
    }
  }

  useEffect(() => {
    loadFriends()
  }, [])

  async function sendRequest() {
    if (!email.trim()) return
    setError('')
    const response = await fetch('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.ok) {
      setEmail('')
      loadFriends()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  async function respond(requestId: string, action: 'accept' | 'decline') {
    setError('')
    const response = await fetch(`/api/friends/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (response.ok) {
      loadFriends()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="mb-2 font-bold">Add a friend</h2>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Friend's email"
            className="rounded border p-2 text-sm"
          />
          <button onClick={sendRequest} className="rounded bg-indigo-600 p-2 text-sm text-white">Send request</button>
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {data.incoming.length > 0 && (
        <div>
          <h3 className="mb-2 font-bold">Pending requests</h3>
          <ul className="flex flex-col gap-1">
            {data.incoming.map((request) => (
              <li key={request.id} className="flex items-center gap-2 text-sm">
                <span>{request.requester.name ?? 'Unknown'}</span>
                <button onClick={() => respond(request.id, 'accept')} className="rounded border p-1 text-xs">Accept</button>
                <button onClick={() => respond(request.id, 'decline')} className="rounded border p-1 text-xs">Decline</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.outgoing.length > 0 && (
        <div>
          <h3 className="mb-2 font-bold">Sent requests</h3>
          <ul className="flex flex-col gap-1">
            {data.outgoing.map((request) => (
              <li key={request.id} className="text-sm text-gray-500">{request.addressee.name ?? 'Unknown'} (pending)</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-bold">Friends</h3>
        <ul className="flex flex-col gap-1">
          {data.friends.map((friend) => (
            <li key={friend.id} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[friend.status]}`} />
              <span>{friend.name ?? 'Unknown'}</span>
              <button onClick={() => onMessageFriend(friend.id, friend.name)} className="ml-auto rounded border p-1 text-xs">Message</button>
            </li>
          ))}
          {data.friends.length === 0 && <p className="text-xs text-gray-500">No friends yet.</p>}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FriendsPanel.tsx
git commit -m "feat: add FriendsPanel UI component"
```

### Task 7.6: Wire Friends into the app shell

**Files:**
- Modify: `apps/web/src/components/ServerSidebar.tsx`
- Modify: `apps/web/src/app/(main)/page.tsx`

**Interfaces:**
- Produces: a "Friends" nav entry (alongside "Direct Messages") that shows `FriendsPanel` in place of the DM/server view.

- [ ] **Step 1: Add a "Friends" nav entry to `ServerSidebar`**

Modify `apps/web/src/components/ServerSidebar.tsx`: add `onOpenFriends: () => void` and `friendsActive: boolean` to the props (alongside `onOpenDMs`/`dmsActive` from Task 6.8):

```typescript
export function ServerSidebar({
  servers,
  activeServerId,
  onSelect,
  onCreated,
  onLeft,
  onOpenDMs,
  dmsActive,
  onOpenFriends,
  friendsActive,
}: {
  servers: Server[]
  activeServerId: string | null
  onSelect: (serverId: string) => void
  onCreated: (server: Server) => void
  onLeft: (serverId: string) => void
  onOpenDMs: () => void
  dmsActive: boolean
  onOpenFriends: () => void
  friendsActive: boolean
}) {
```

Add a second button right after the "Direct Messages" button added in Task 6.8:

```typescript
      <button
        onClick={onOpenFriends}
        className={`rounded p-2 text-left ${friendsActive ? 'bg-indigo-100' : ''}`}
      >
        Friends
      </button>
```

- [ ] **Step 2: Wire it into `page.tsx`**

Modify `apps/web/src/app/(main)/page.tsx`. Add the import:

```typescript
import { FriendsPanel } from '@/components/FriendsPanel'
```

Change the `view` state type from `'server' | 'dm'` to `'server' | 'dm' | 'friends'`:

```typescript
  const [view, setView] = useState<'server' | 'dm' | 'friends'>('server')
```

Add `onOpenFriends`/`friendsActive` to the `<ServerSidebar>` element:

```typescript
        onOpenFriends={() => setView('friends')}
        friendsActive={view === 'friends'}
```

Add a `view === 'friends'` branch to the render logic — change the `{view === 'dm' ? (...) : activeServer ? (...) : (...)}` chain to:

```typescript
      {view === 'friends' ? (
        <FriendsPanel onMessageFriend={openDM} />
      ) : view === 'dm' ? (
        <>
          <DMSidebar
            activeOtherUserId={activeDM?.userId ?? null}
            onSelect={(userId, name) => setActiveDM({ userId, name })}
            refreshKey={dmRefreshKey}
          />
          {activeDM && session?.user?.id ? (
            <DMPanel otherUserId={activeDM.userId} otherUserName={activeDM.name} currentUserId={session.user.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a conversation</div>
          )}
        </>
      ) : activeServer ? (
```

(Everything after that — the `activeServer ? (...)` branch's contents and the final `: (...)` fallback — stays exactly as Task 6.8 left it; this only adds the new leading branch and changes `view === 'dm' ?` to a chained `view === 'friends' ? ... : view === 'dm' ? ...`.)

- [ ] **Step 3: Verify the app builds and all tests pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ServerSidebar.tsx "apps/web/src/app/(main)/page.tsx"
git commit -m "feat: wire friends system into the app shell"
```

### Task 7.7: Phase 7 manual checkpoint

- [ ] **Step 1: Start everything** (same as Task 6.9 Step 1, skip if already running)

- [ ] **Step 2: Friend request flow test**

1. As User A: `POST /api/friends/requests` with User B's email. Confirm `201`.
2. As User B: `GET /api/friends`, confirm the request appears under `incoming`.
3. As User B: `PATCH /api/friends/requests/:id` with `{ action: 'accept' }`. Confirm `200`.
4. As User A and User B both: `GET /api/friends`, confirm each sees the other under `friends`.
5. As User A: attempt `POST /api/friends/requests` to User B's email again. Confirm `400` (duplicate).

**Phase 7 checkpoint:** friend requests can be sent, accepted, declined, and both users end up with each other in their friends list, from which a DM can be opened (already proven working in Phase 6). This is the point to stop and verify locally before continuing to Phase 8.

---

## Phase 8: Image Attachments

**Deliverable:** Upload an avatar, upload a server icon, and post a message with an attached image — all three render correctly for every viewer.

**This phase requires a real Supabase project** — the first point in this project where local Docker Postgres alone isn't enough, since Supabase Storage (an S3-compatible object store) has no local-Docker equivalent already running. Task 8.2 is a manual setup step; everything after it assumes that setup is complete.

### Task 8.1: Add `Message.attachmentUrl`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `Message.attachmentUrl String?` — an optional public URL, set when a message includes an image.

- [ ] **Step 1: Add the field to the `Message` model**

Add this field to the existing `Message` model, alongside `content`:

```prisma
  attachmentUrl    String?
```

- [ ] **Step 2: Regenerate the client and migrate both databases**

Run:
```bash
npm run generate --workspace=packages/database
npm run migrate:dev --workspace=packages/database -- --name add_message_attachment_url
npm run migrate:test --workspace=packages/database
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add Message.attachmentUrl"
```

### Task 8.2: Supabase Storage project setup (manual — requires your action)

**This task cannot be completed by an autonomous coding agent** — it requires creating a real account and project in Supabase's dashboard. Stop here and complete these steps yourself before continuing to Task 8.3:

- [ ] **Step 1: Create a Supabase project**

Go to [supabase.com](https://supabase.com), create a free project (any name/region). Wait for provisioning to finish.

- [ ] **Step 2: Create a public Storage bucket**

In the project dashboard, go to Storage → Create a new bucket. Name it `attachments`. Set it **Public** (this plan's Global Constraints deliberately use public-read buckets to avoid signed-URL complexity at this scope).

- [ ] **Step 3: Collect credentials**

From Project Settings → API, copy:
- **Project URL** (e.g. `https://xxxxx.supabase.co`)
- **service_role key** (NOT the `anon` key — the service-role key is required for server-side uploads and must never be sent to the browser; keep it out of any `NEXT_PUBLIC_*` variable)

- [ ] **Step 4: Add to `apps/web/.env.local`**

Add these two lines (gitignored, local-only):
```
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

- [ ] **Step 5: Document in `.env.example`**

Add these two lines to `apps/web/.env.example` (committed, placeholder values):
```
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
```

Run: `git add apps/web/.env.example && git commit -m "docs: document Supabase Storage env vars"`

Once this is done, continue to Task 8.3 — every task after this one assumes `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set in your local `apps/web/.env.local`.

### Task 8.3: Supabase client + upload helper

**Files:**
- Create: `apps/web/src/lib/supabase.ts`

**Interfaces:**
- Produces: `uploadImage(file: File, pathPrefix: string): Promise<string>` — uploads an image file to the `attachments` bucket under `${pathPrefix}/${timestamp}.${ext}`, returns the public URL. Throws if the file isn't an image or the upload fails (callers — Tasks 8.4-8.6 — catch this and turn it into a 400/500 response).

No automated test — this function's only logic is a thin wrapper around the Supabase SDK requiring a real network call to Storage; it's exercised by Task 8.9's manual checkpoint (which requires the real Supabase project from Task 8.2 to already exist) rather than mocked in a unit test, since mocking the entire Supabase client would test the mock, not the integration.

- [ ] **Step 1: Add the `@supabase/supabase-js` dependency**

Run: `npm install @supabase/supabase-js@^2 --workspace=apps/web`
Expected: completes with no errors.

- [ ] **Step 2: Create `apps/web/src/lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey) : null

const ATTACHMENTS_BUCKET = 'attachments'
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function uploadImage(file: File, pathPrefix: string): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error('Supabase Storage is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing)')
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed')
  }

  const extension = file.type.split('/')[1]
  const path = `${pathPrefix}/${Date.now()}.${extension}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error } = await supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: true,
  })
  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  const { data } = supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/src/lib/supabase.ts
git commit -m "feat: add Supabase Storage upload helper"
```

### Task 8.4: Avatar upload API

**Files:**
- Create: `apps/web/src/app/api/uploads/avatar/route.ts`

**Interfaces:**
- Consumes: `auth` (existing), `uploadImage` (Task 8.3).
- Produces: `POST /api/uploads/avatar` accepting `multipart/form-data` with a `file` field, uploads it, updates `User.image`, returns `200` with `{ image: string }`. Returns `401` if not authenticated, `400` if no file or the upload helper throws.

No automated test — requires a real Supabase upload (Task 8.2's manual setup), verified in Task 8.9.

- [ ] **Step 1: Create `apps/web/src/app/api/uploads/avatar/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'
import { uploadImage } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let url: string
  try {
    url = await uploadImage(file, `avatars/${session.user.id}`)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 })
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { image: url } })

  return NextResponse.json({ image: url }, { status: 200 })
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/uploads/avatar
git commit -m "feat: add avatar upload API"
```

### Task 8.5: Server icon upload API

**Files:**
- Create: `apps/web/src/app/api/servers/[serverId]/icon/route.ts`

**Interfaces:**
- Consumes: `requireMembership` (existing).
- Produces: `POST /api/servers/:serverId/icon` accepting `multipart/form-data`, uploads, updates `Server.icon`, returns `200` with `{ icon: string }`. Gated on the caller's role being `OWNER` — no existing `@repo/permissions` function covers "can change server identity," so this uses a direct role check rather than borrowing an unrelated one (a disclosed, deliberate choice: the server's icon is identity-level, narrower than channel/member management, so `OWNER`-only is the more conservative default).

No automated test — same reasoning as Task 8.4.

- [ ] **Step 1: Create `apps/web/src/app/api/servers/[serverId]/icon/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { uploadImage } from '@/lib/supabase'

export async function POST(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (result.membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the server owner can change the icon' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let url: string
  try {
    url = await uploadImage(file, `server-icons/${serverId}`)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 })
  }

  await prisma.server.update({ where: { id: serverId }, data: { icon: url } })

  return NextResponse.json({ icon: url }, { status: 200 })
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/servers/[serverId]/icon"
git commit -m "feat: add server icon upload API"
```

### Task 8.6: Message image upload API

**Files:**
- Create: `apps/web/src/app/api/uploads/message-image/route.ts`

**Interfaces:**
- Produces: `POST /api/uploads/message-image` accepting `multipart/form-data`, uploads, returns `200` with `{ url: string }` — no message row is touched here (per this plan's Global Constraints, the upload happens before the message is sent; the URL is then included in the `message:new`/`dm:message:new` socket emit, Task 8.7).

No automated test — same reasoning as Task 8.4.

- [ ] **Step 1: Create `apps/web/src/app/api/uploads/message-image/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { uploadImage } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let url: string
  try {
    url = await uploadImage(file, `message-images/${session.user.id}`)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 })
  }

  return NextResponse.json({ url }, { status: 200 })
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build --workspace=apps/web`
Expected: "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/uploads/message-image
git commit -m "feat: add message image upload API"
```

### Task 8.7: Thread `attachmentUrl` through message send/broadcast/history

**Files:**
- Modify: `apps/socket-server/src/types.ts`
- Modify: `apps/socket-server/src/messages.ts`
- Modify: `apps/socket-server/src/dms.ts`
- Modify: `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts`
- Modify: `apps/web/src/app/api/dms/[otherUserId]/messages/route.ts`

**Interfaces:**
- Produces: `MessagePayload`/`DMMessagePayload` both gain an optional `attachmentUrl: string | null`. `message:new`/`dm:message:new`'s client-emit payloads gain an optional `attachmentUrl?: string`. Both REST history endpoints include it in their response mapping.

- [ ] **Step 1: Add `attachmentUrl` to the shared payload/event types**

Replace `apps/socket-server/src/types.ts`'s `MessagePayload`, `DMMessagePayload`, and the `message:new`/`dm:message:new` entries in `ClientToServerEvents` (leave everything else in the file unchanged) with:

```typescript
export interface MessagePayload {
  id: string
  content: string
  channelId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}

export interface DMMessagePayload {
  id: string
  content: string
  dmConversationId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}
```

In `ClientToServerEvents`, change the `message:new` and `dm:message:new` entries to:

```typescript
  'message:new': (
    payload: { channelId: string; content: string; attachmentUrl?: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
```

```typescript
  'dm:message:new': (
    payload: { recipientUserId: string; content: string; attachmentUrl?: string },
    ack: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void
```

(Every other entry in both interfaces — `channel:join`/`leave`, `message:delete`, `typing:*`, `presence:*`, `dm:join`/`leave`, `dm:message:delete` — stays exactly as it was.)

- [ ] **Step 2: Update `apps/socket-server/src/messages.ts`'s `message:new` handler**

Change the handler's destructured payload and the `prisma.message.create`/payload-building code. Replace:

```typescript
  socket.on(
    'message:new',
    safeHandler(async ({ channelId, content }, ack) => {
```

with:

```typescript
  socket.on(
    'message:new',
    safeHandler(async ({ channelId, content, attachmentUrl }, ack) => {
```

Replace the `prisma.message.create` call:

```typescript
      const message = await prisma.message.create({
        data: { content: trimmed, channelId, authorId: socket.data.userId, attachmentUrl: attachmentUrl ?? null },
        include: { author: { select: { id: true, name: true, image: true } } },
      })
```

Replace the payload-building block to include `attachmentUrl: message.attachmentUrl`. Note: this block currently reads `channelId,` (the local destructured variable), not `message.channelId` — a Task 6.1 follow-up fix (commit `904a095`) changed it from the latter, since `Message.channelId` became optional in the schema to support DM messages, and Prisma's generated `string | null` type for `message.channelId` no longer satisfies `MessagePayload`'s non-null `channelId: string` when read back after the `create` call. Using the already-known-non-null local `channelId` sidesteps that; keep using it here, don't revert to `message.channelId`:

```typescript
      const payload: MessagePayload = {
        id: message.id,
        content: message.content,
        channelId,
        createdAt: message.createdAt.toISOString(),
        attachmentUrl: message.attachmentUrl,
        author: message.author,
      }
```

- [ ] **Step 3: Update `apps/socket-server/src/dms.ts`'s `dm:message:new` handler**

Apply the same three changes: destructure `attachmentUrl` from the payload, pass it to `prisma.message.create`'s `data`, include it in the `DMMessagePayload` built afterward. Mirror Step 2's edits exactly, applied to the `dm:message:new` handler instead of `message:new`.

- [ ] **Step 4: Verify the socket-server app builds**

Run: `npm run build --workspace=apps/socket-server`
Expected: compiles with no TypeScript errors.

- [ ] **Step 5: Update both REST history endpoints**

Modify `apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts`: add `attachmentUrl: message.attachmentUrl,` to the `payload.map(...)` object (alongside `id`, `content`, `channelId`, `createdAt`, `author`).

Modify `apps/web/src/app/api/dms/[otherUserId]/messages/route.ts`: add `attachmentUrl: message.attachmentUrl,` to its `payload.map(...)` object the same way.

- [ ] **Step 6: Run the full web test suite**

Run: `npm test --workspace=apps/web`
Expected: PASS — every existing test still passes (the new field is additive; no existing assertion checks the object is missing it via strict equality... verify this is true by checking the test output for any unexpected failures, since a couple of the message-history tests DO use `toEqual`/exact object matching on the author field only, not the whole message object, so they should be unaffected — but confirm rather than assume).

- [ ] **Step 7: Commit**

```bash
git add apps/socket-server/src/types.ts apps/socket-server/src/messages.ts apps/socket-server/src/dms.ts "apps/web/src/app/api/servers/[serverId]/channels/[channelId]/messages/route.ts" apps/web/src/app/api/dms
git commit -m "feat: thread attachmentUrl through message send/broadcast/history"
```

### Task 8.8: Upload UI — avatar, server icon, message image

**Files:**
- Modify: `apps/web/src/components/ServerSidebar.tsx`
- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/components/DMPanel.tsx`

**Interfaces:**
- Produces: an avatar-upload control and a server-icon-upload control (both in `ServerSidebar`, the closest existing thing to a "profile/server settings" area — no dedicated settings page exists in this plan's scope, so these are added as compact inline controls rather than a new page), and a message-image-attach control in both chat panels.

- [ ] **Step 1: Add avatar and server-icon upload controls to `ServerSidebar`**

Read `apps/web/src/components/ServerSidebar.tsx`'s current full contents first (it has Task 7.6's `onOpenFriends`/`friendsActive` props already). No new imports are needed — `useState` and `parseErrorResponse` are both already imported in this file. Add this state and these two functions inside the component body, alongside the existing `useState` calls:

```typescript
  const [avatarError, setAvatarError] = useState('')
  const [iconError, setIconError] = useState('')

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarError('')

    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/avatar', { method: 'POST', body: formData })
    if (!response.ok) {
      setAvatarError(await parseErrorResponse(response))
    }
    event.target.value = ''
  }

  async function uploadServerIcon(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !activeServerId) return
    setIconError('')

    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`/api/servers/${activeServerId}/icon`, { method: 'POST', body: formData })
    if (!response.ok) {
      setIconError(await parseErrorResponse(response))
    }
    event.target.value = ''
  }
```

Add the avatar upload control right after the existing "Log out" button's containing `<div className="flex items-center justify-between">...</div>` block:

```typescript
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">
          Update avatar
          <input type="file" accept="image/*" onChange={uploadAvatar} className="mt-1 block w-full text-xs" />
        </label>
        {avatarError && <p className="text-xs text-red-500">{avatarError}</p>}
      </div>
```

Add the server-icon upload control right after the closing `</ul>` of the server list, before the `leaveError` paragraph — only shown when a server is active:

```typescript
      {activeServerId && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">
            Update server icon
            <input type="file" accept="image/*" onChange={uploadServerIcon} className="mt-1 block w-full text-xs" />
          </label>
          {iconError && <p className="text-xs text-red-500">{iconError}</p>}
        </div>
      )}
```

- [ ] **Step 2: Add a message-image attach control to `ChatPanel`**

Read `apps/web/src/components/ChatPanel.tsx`'s current full contents first. Add this state inside the component body:

```typescript
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
```

Add this function near `sendMessage`:

```typescript
  async function attachImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/message-image', { method: 'POST', body: formData })
    if (response.ok) {
      const { url } = await response.json()
      setAttachmentUrl(url)
    } else {
      setError(await parseErrorResponse(response))
    }
    setUploading(false)
    event.target.value = ''
  }
```

Note: `ChatPanel.tsx` doesn't currently import `parseErrorResponse` — add `import { parseErrorResponse } from '@/lib/parseErrorResponse'` alongside its existing imports.

Update `sendMessage` to include `attachmentUrl` in the emitted payload and clear it afterward — change:

```typescript
    getSocket().emit('message:new', { channelId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
```

to:

```typescript
    getSocket().emit('message:new', { channelId, content, attachmentUrl: attachmentUrl ?? undefined }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
    setAttachmentUrl(null)
```

Update the `Message` type at the top of the file to include `attachmentUrl: string | null`, alongside `id`/`content`/`channelId`/`createdAt`/`author`.

In the message-rendering block, render the image when present — add this line right after the `<p>{message.content}</p>` line, inside the same `<div>`:

```typescript
              {message.attachmentUrl && <img src={message.attachmentUrl} alt="attachment" className="mt-1 max-w-xs rounded" />}
```

Add the file input and a small "attached" indicator to the `<form>`, right before the existing `<input value={content} .../>`:

```typescript
        <input type="file" accept="image/*" onChange={attachImage} disabled={uploading} className="text-xs" />
        {attachmentUrl && <span className="self-center text-xs text-green-600">Image attached</span>}
```

- [ ] **Step 3: Add the same control to `DMPanel`**

Modify `apps/web/src/components/DMPanel.tsx` (its current contents are exactly what Task 6.7 created — no other task has touched it since). Add this import alongside the existing `getSocket` import:

```typescript
import { parseErrorResponse } from '@/lib/parseErrorResponse'
```

Update the `DMMessage` type to add `attachmentUrl: string | null`, alongside `id`/`content`/`dmConversationId`/`createdAt`/`author`:

```typescript
type DMMessage = {
  id: string
  content: string
  dmConversationId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}
```

Add this state inside the component body, alongside the existing `useState` calls:

```typescript
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
```

Add this function near `sendMessage` — identical body to `ChatPanel`'s `attachImage` from Step 2 (the upload endpoint isn't channel- or DM-specific):

```typescript
  async function attachImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/message-image', { method: 'POST', body: formData })
    if (response.ok) {
      const { url } = await response.json()
      setAttachmentUrl(url)
    } else {
      setError(await parseErrorResponse(response))
    }
    setUploading(false)
    event.target.value = ''
  }
```

Update `sendMessage` to include `attachmentUrl` in the emitted payload and clear it afterward — change:

```typescript
    getSocket().emit('dm:message:new', { recipientUserId: otherUserId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
```

to:

```typescript
    getSocket().emit('dm:message:new', { recipientUserId: otherUserId, content, attachmentUrl: attachmentUrl ?? undefined }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
    setAttachmentUrl(null)
```

In the message-rendering block, add the image render right after the `<p>{message.content}</p>` line, inside the same `<div>`:

```typescript
              {message.attachmentUrl && <img src={message.attachmentUrl} alt="attachment" className="mt-1 max-w-xs rounded" />}
```

Add the file input and "attached" indicator to the `<form>`, right before the existing `<input value={content} .../>`:

```typescript
        <input type="file" accept="image/*" onChange={attachImage} disabled={uploading} className="text-xs" />
        {attachmentUrl && <span className="self-center text-xs text-green-600">Image attached</span>}
```

- [ ] **Step 4: Verify the app builds and all tests pass**

Run:
```bash
npm run build --workspace=apps/web
npm test --workspace=apps/web
```
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ServerSidebar.tsx apps/web/src/components/ChatPanel.tsx apps/web/src/components/DMPanel.tsx
git commit -m "feat: add avatar, server icon, and message image upload UI"
```

### Task 8.9: Phase 8 manual checkpoint

**Requires the real Supabase project from Task 8.2.** No browser is available in this sandbox — verify via curl with an actual local image file, which exercises the real Supabase Storage upload end-to-end (this is the one checkpoint in this plan that cannot be meaningfully faked or skipped, since it's the only phase touching a genuinely external service).

- [ ] **Step 1: Start everything**

```bash
docker compose up -d
npm run dev:socket
npm run dev:web
```

- [ ] **Step 2: Avatar upload test**

With a real small PNG/JPEG file on disk and a valid session cookie:
```bash
curl -b cookies.txt -X POST http://localhost:3000/api/uploads/avatar -F "file=@/path/to/test-image.png"
```
Expected: `200` with `{"image": "https://<project>.supabase.co/storage/v1/object/public/attachments/avatars/..."}`. Open that URL directly in a browser (or `curl` it and confirm a `200` with an image content-type) — confirm the actual image is retrievable from Supabase Storage, not just that the API call succeeded.

- [ ] **Step 3: Server icon upload test**

Same pattern against `/api/servers/:serverId/icon` (as the server's OWNER). Confirm `200` and the URL is retrievable. Then attempt the same call as a MEMBER of that server — confirm `403`.

- [ ] **Step 4: Message image test**

1. `POST /api/uploads/message-image` with the same test file — confirm `200` with `{"url": "..."}`.
2. Using a `socket.io-client` connection, emit `message:new` with `{ channelId, content: 'check out this image', attachmentUrl: <the URL from step 1> }`.
3. Confirm the broadcast `message:new` event includes `attachmentUrl` matching what was sent, and `GET .../messages` (history) for that channel shows the same `attachmentUrl` on that message.
4. Repeat for a DM: `dm:message:new` with `attachmentUrl` set, confirm the broadcast and `GET /api/dms/:otherUserId/messages` both carry it.

- [ ] **Step 5: Stop everything**

Stop both dev servers. `docker compose down` if you're done for the session.

**Phase 8 checkpoint:** avatars, server icons, and message images all upload to real Supabase Storage and the resulting URLs are correctly persisted, broadcast, and retrievable via history. This completes the deliverable this plan document covers — Phase 9 (deployment) is handled separately, outside this plan, by the project owner directly.

---

## Self-Review Notes

- **Spec coverage (Phase 6-8 rows of the design spec's phase table):** direct messages ✓ (Tasks 6.1-6.9, including the deterministic-room-naming fix for the "second participant never joined before the first message" race that a naive conversation-ID-keyed room would have hit), friends system ✓ (Tasks 7.1-7.7), image attachments ✓ (Tasks 8.1-8.9, avatar/server-icon/message-image all covered). Voice/video, message edit history, reactions/threads, blocking users, and read receipts remain correctly out of scope per the original spec. Phase 9 (deployment) is explicitly and deliberately excluded from this plan document per the project owner's direction — not a gap, a scoping decision made at plan-creation time.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable commands or complete code, including the manual Task 8.2 (which is genuinely manual by necessity — no code to write for creating a Supabase account — but every step in it is a concrete, actionable instruction, not a placeholder).
- **Type consistency:** `DMMessagePayload` (Task 6.4, extended in Task 8.7) is used identically by the DM history endpoint (Task 6.6) and `DMPanel` (Task 6.7/8.8) — same field names, same nested `author` shape, matching the precedent `MessagePayload` already established for channels in Phase 3. `dmRoom(userIdA, userIdB)` is used consistently by `dm:join`/`dm:leave` (Task 6.3), `dm:message:new`'s broadcast (Task 6.4), and `dm:message:delete`'s broadcast (Task 6.5) — always with the two real participant IDs in some order, never a placeholder or conversation ID. The `view` state in `(main)/page.tsx` grows from a Task 6.8-introduced `'server' | 'dm'` union to a Task 7.6-introduced `'server' | 'dm' | 'friends'` union — checked that Task 7.6's replacement snippet is additive (a new leading ternary branch) and doesn't drop or restructure Task 6.8's existing `'dm'`/server branches.
- **Cross-task file-modification consistency:** `apps/socket-server/src/types.ts` is rewritten in full by Task 6.4, then incrementally modified by Tasks 6.3 (before 6.4 in task order — wait, checked: Task 6.3 modifies it first with `dm:join`/`dm:leave` only, Task 6.4 replaces the whole file including 6.3's additions plus its own, Task 6.5 does a partial replacement of just the two event interfaces, Task 8.7 does another partial replacement of just `MessagePayload`/`DMMessagePayload`/the two `message:new` entries) — each step's shown content was checked against the immediately-prior task's version to confirm nothing already-added gets silently dropped. `apps/web/src/components/ServerSidebar.tsx` picks up new props across Task 6.8 (`onOpenDMs`/`dmsActive`) and Task 7.6 (`onOpenFriends`/`friendsActive`) and Task 8.8 (upload controls, no new props) — each task's snippet was written assuming the immediately-prior task's version of the file, not the Phase 5 original in isolation.
- **A note for whoever writes the Phase 9 (deployment) plan, whenever that happens:** the socket-server's `WEB_ORIGIN` env var and the web app's `NEXT_PUBLIC_SOCKET_SERVER_URL` env var will need real deployed-service URLs (not `localhost`) once both services move off local dev — this was already true before this plan and isn't new, but Phase 8 adds a THIRD external-URL dependency (`SUPABASE_URL`) that a deployment plan will also need to carry into whatever hosting platform's environment-variable configuration is used. All three are already documented in the relevant `.env.example` files.
