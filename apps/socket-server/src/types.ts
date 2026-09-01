import type { Server, Socket } from 'socket.io'

export interface SocketData {
  userId: string
}

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

export interface TypingPayload {
  channelId: string
  userId: string
}

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'OFFLINE'

export interface PresencePayload {
  userId: string
  status: PresenceStatus
}

export interface ProfilePayload {
  userId: string
  name: string | null
  image: string | null
  customStatus: string | null
  bio: string | null
}

export interface ClientToServerEvents {
  'channel:join': (payload: { channelId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'channel:leave': (payload: { channelId: string }) => void
  'message:new': (
    payload: { channelId: string; content: string; attachmentUrl?: string },
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
  'profile:updated': () => void
  'dm:join': (payload: { otherUserId: string }, ack: (response: { ok: true } | { ok: false; error: string }) => void) => void
  'dm:leave': (payload: { otherUserId: string }) => void
  'dm:message:new': (
    payload: { recipientUserId: string; content: string; attachmentUrl?: string },
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
  'profile:update': (payload: ProfilePayload) => void
  'dm:message:new': (message: DMMessagePayload) => void
  'dm:message:delete': (payload: { dmConversationId: string; messageId: string }) => void
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
