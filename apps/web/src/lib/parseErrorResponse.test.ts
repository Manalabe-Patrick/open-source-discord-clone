import { describe, it, expect } from 'vitest'
import { parseErrorResponse } from './parseErrorResponse'

describe('parseErrorResponse', () => {
  it('returns the error field from a JSON error body', async () => {
    const response = new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(await parseErrorResponse(response)).toBe('Not authenticated')
  })

  it('falls back to the default message when the body is not JSON', async () => {
    const response = new Response('<html>redirect</html>', {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
    })
    expect(await parseErrorResponse(response)).toBe('Something went wrong')
  })

  it('falls back to a custom message when provided', async () => {
    const response = new Response('', { status: 500 })
    expect(await parseErrorResponse(response, 'Custom fallback')).toBe('Custom fallback')
  })

  it('falls back when content-type claims JSON but the body is malformed', async () => {
    const response = new Response('not actually json', {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(await parseErrorResponse(response)).toBe('Something went wrong')
  })

  it('falls back when the JSON body has no error field', async () => {
    const response = new Response(JSON.stringify({ message: 'oops' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(await parseErrorResponse(response)).toBe('Something went wrong')
  })
})
