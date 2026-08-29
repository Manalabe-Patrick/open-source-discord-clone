import { describe, it, expect, afterAll } from 'vitest'
import { createServer } from './index.js'

describe('health check', () => {
  const { httpServer } = createServer()

  afterAll(() => {
    httpServer.close()
  })

  it('responds ok on GET /health', async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const address = httpServer.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const response = await fetch(`http://localhost:${port}/health`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })
})
