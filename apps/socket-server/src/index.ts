import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { fileURLToPath } from 'url'
import path from 'path'
import { getUserIdFromCookieHeader } from './auth.js'
import { registerChannelHandlers } from './channels.js'
import { registerMessageHandlers } from './messages.js'
import { registerTypingHandlers } from './typing.js'
import { registerPresenceHandlers } from './presence.js'
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

  io.on('connection', (socket) => {
    registerChannelHandlers(io, socket)
    registerMessageHandlers(io, socket)
    registerTypingHandlers(io, socket)
    registerPresenceHandlers(io, socket)
  })

  return { app, httpServer, io }
}

const isMain = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (isMain) {
  if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) {
    console.error('FATAL: Neither NEXTAUTH_SECRET nor AUTH_SECRET is set. Socket connections cannot be authenticated.')
    process.exit(1)
  }

  process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error)
  })
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error)
  })

  const { httpServer } = createServer()
  const port = process.env.PORT ? Number(process.env.PORT) : 4000
  httpServer.listen(port, () => {
    console.log(`socket-server listening on port ${port}`)
  })
}
