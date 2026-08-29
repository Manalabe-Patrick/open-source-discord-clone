import express from 'express'
import cors from 'cors'
import { createServer as createHttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

export function createServer() {
  const app = express()
  app.use(cors())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const httpServer = createHttpServer(app)
  const io = new SocketIOServer(httpServer, {
    cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' },
  })

  return { app, httpServer, io }
}

const isMain = process.argv[1] && process.argv[1].endsWith('index.ts')
if (isMain) {
  const { httpServer } = createServer()
  const port = process.env.PORT ? Number(process.env.PORT) : 4000
  httpServer.listen(port, () => {
    console.log(`socket-server listening on port ${port}`)
  })
}
