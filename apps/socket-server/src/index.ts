import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { fileURLToPath } from 'url'
import path from 'path'

export function createServer() {
  const app = express()
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const httpServer = createHttpServer(app)
  const io = new SocketIOServer(httpServer, {
    cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' },
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
