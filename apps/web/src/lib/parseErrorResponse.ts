/**
 * Safely extracts a human-readable error message from a non-OK fetch Response.
 * Falls back to a generic message if the body isn't parseable JSON (e.g. an
 * HTML error page or an empty body), since blindly calling response.json()
 * throws when the body isn't valid JSON.
 */
export async function parseErrorResponse(response: Response, fallback = 'Something went wrong'): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return fallback
  }

  try {
    const body = await response.json()
    if (body && typeof body.error === 'string' && body.error.trim()) {
      return body.error
    }
    return fallback
  } catch {
    return fallback
  }
}
