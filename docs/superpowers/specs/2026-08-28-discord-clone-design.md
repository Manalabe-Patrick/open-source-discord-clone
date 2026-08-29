# Discord Clone (Portfolio Project) — Design Spec

## Purpose

A portfolio project demonstrating full-stack development skill with a specific
emphasis on real-time/WebSocket systems. It is not intended to be a production
Discord competitor — scope is deliberately trimmed to what showcases skill
without ballooning into months of work (notably: no voice/video).

## Goals

- Showcase full-stack breadth: auth, relational data modeling, REST-style API
  routes, file uploads, deployment.
- Showcase real-time systems depth: WebSocket connection lifecycle, room-based
  broadcast, presence, typing indicators.
- Ship something a reviewer can actually click through end-to-end in
  production, not just read code for.

## Out of scope

- Voice/video channels (WebRTC) — by far the most complex part of Discord and
  not worth the time budget for a portfolio piece.
- Message editing history / audit logs.
- Granular custom permission bitfields — three fixed roles (Owner/Admin/Member)
  cover the "roles matter" story without building a permissions engine.
- Blocking users, server discovery/invites beyond a basic invite link,
  read receipts, reactions/emoji, threads.

## Architecture

Two deployable services sharing one Postgres database:

- **`web`** — Next.js 14 (App Router, TypeScript, Tailwind CSS). Handles UI,
  authentication (NextAuth/Auth.js with Credentials + Google OAuth), and all
  non-realtime CRUD (servers, channels, friends, roles, uploads) via API
  routes + Prisma.
- **`socket-server`** — standalone Node + Socket.IO service. Owns the
  real-time path: sending/receiving messages, typing indicators, presence.
  It has its own Prisma client pointed at the same database, so it persists a
  message and broadcasts it in the same step — no HTTP round-trip back into
  `web` on the hot path.

**Why split them:** Vercel (the target host for `web`) does not support
long-lived WebSocket connections, so the realtime server must run somewhere
that does (Railway or Render, as an always-on Node process).

**Auth bridge:** NextAuth issues a JWT session token. The browser passes that
token during the Socket.IO connection handshake; `socket-server` verifies it
with the shared `NEXTAUTH_SECRET` (via `jwt.verify`) and loads the user via
Prisma. There is no separate login for the socket server.

## Data model (Prisma / Supabase Postgres)

- `User` — NextAuth standard fields + `status` (`ONLINE` / `IDLE` / `OFFLINE`)
- `Account`, `Session` — NextAuth standard tables
- `Server` (guild) — `id`, `name`, `icon`, `ownerId`
- `Membership` — join table: `userId`, `serverId`, `role` (`OWNER` / `ADMIN` /
  `MEMBER`)
- `Channel` — `id`, `serverId`, `name`, `type` (`TEXT` only, in scope)
- `Message` — `id`, `authorId`, `content`, `attachmentUrl?`, `createdAt`, and
  exactly one of `channelId` or `dmConversationId` set
- `DMConversation` — `id`
- `DMParticipant` — join table: `userId`, `dmConversationId`
- `FriendRequest` — `id`, `requesterId`, `addresseeId`, `status` (`PENDING` /
  `ACCEPTED` / `DECLINED`)

DM conversations are created lazily — accepting a friend request does not
create one; the first message between two friends creates it.

## Real-time events (Socket.IO)

- `channel:join` / `channel:leave` — join/leave a room keyed by channel ID
- `dm:join` / `dm:leave` — same, keyed by DM conversation ID
- `message:new` — client emits to send; server persists via Prisma, then
  broadcasts to the room
- `message:delete` — author or admin/owner deletes, broadcast to room
- `typing:start` / `typing:stop` — broadcast only, never persisted
- `presence:update` — broadcast when a user's status changes (driven by
  socket connect/disconnect and a heartbeat/idle timeout)

## Permissions

Three fixed roles per server: **Owner** (set automatically on server
creation, cannot be removed), **Admin**, **Member**. Implemented as plain
permission-check helper functions (e.g. `canCreateChannel(role)`,
`canKickMember(role)`, `canDeleteChannel(role)`), called from both the
Next.js API routes (CRUD) and `socket-server` (message moderation — deleting
others' messages). No custom permission bitfield system.

## Testing approach

Vitest, TDD per phase. Tests focus on logic that's cheap to unit-test and
easy to break silently:

- Permission helper functions — pure functions, tested exhaustively for all
  role/action combinations.
- API route handlers for CRUD (servers, channels, friends, roles) — tested
  against a real test Postgres schema via Prisma (separate `DATABASE_URL` for
  tests, reset between test runs), not mocked, since the goal is catching
  real query bugs.
- Validation logic (can't friend yourself, can't post an empty message, etc.)

Realtime socket behavior (broadcast, typing, presence) is verified manually
in-browser per phase rather than automated — automating Socket.IO round-trips
in Vitest adds significant harness complexity for low payoff at this scope.
The implementation plan spells out concrete manual test steps per phase
(e.g. "open two browser windows, join the same channel, confirm the message
appears in both").

## Deployment

- `web` → Vercel
- `socket-server` → Railway (or Render), always-on Node service
- Supabase → Postgres database + Storage bucket (avatars, server icons,
  message image attachments)
- Environment variables (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
  Google OAuth client ID/secret, Supabase URL/keys, socket server URL)
  documented in a `.env.example` in each app.

Deployment happens once, in the final phase, after the app is fully
functional locally.

## Phase breakdown

Each phase produces a deliverable you can run and click through before
moving to the next one.

| Phase | Deliverable | Manual test |
|---|---|---|
| 0 | Monorepo scaffold: Next.js app + socket-server app, TypeScript, Tailwind, ESLint, Prisma init, Vitest wired up in both apps | App boots locally, shows a placeholder page, `npm test` runs green in both apps |
| 1 | Prisma schema for users/auth + NextAuth (Credentials + Google OAuth) | Sign up, log in, log out, session persists on refresh |
| 2 | Servers & channels CRUD + sidebar UI | Create a server, add channels, see them listed in the sidebar; creator becomes Owner |
| 3 | Real-time text chat core (socket-server scaffold, JWT handshake auth, join room, send/receive, message history load on channel open) | Two browser windows in the same channel see each other's messages appear live |
| 4 | Presence + typing indicators | Status changes (online/idle/offline) and "X is typing…" are visible live across windows |
| 5 | Roles & permissions enforcement | A Member is blocked from creating/deleting channels or kicking members; an Admin/Owner can |
| 6 | Direct messages (1:1) | Open a DM with another user, messages arrive live, conversation persists across reloads |
| 7 | Friends system (send/accept/decline requests, friends list) | User A sends a request, user B accepts, both see each other as friends and can jump into a DM |
| 8 | Image attachments (avatar upload, server icon upload, message image attachments via Supabase Storage) | Upload an avatar and post a message with an image; both render correctly |
| 9 | Polish + deployment (responsive layout pass, loading/error states, deploy both services) | The production URL supports the full flow end-to-end: sign up → create server → chat → DM → friends |

## Open risks / things to watch during implementation

- **Presence accuracy**: a user closing their laptop lid vs. a clean
  disconnect can both look like a dropped socket; a short grace period before
  marking a user offline avoids flicker on brief reconnects.
- **Shared Prisma schema between two apps**: `web` and `socket-server` both
  need the same Prisma schema/client. Simplest approach for this scope: keep
  the Prisma schema in `web` and have `socket-server` depend on `web`'s
  generated client package (or duplicate the schema file via a small shared
  package) — the concrete choice is deferred to Phase 0 scaffolding.
