// A message's attachmentUrl is client-supplied and gets rendered as <img src>
// for every viewer with no interaction, so an unvalidated URL is a tracking-pixel
// vector (any authenticated user could point it at a third-party server to log
// viewers' IP/User-Agent). Restrict it to our own Supabase public bucket.
//
// Both the candidate URL and SUPABASE_URL are parsed and compared by exact
// `origin` (scheme + host + port), then the pathname is checked against the
// bucket path — rather than a raw string prefix — so this can't be confused
// by a lookalike host (e.g. `${SUPABASE_URL}.evil.com/...`) or by a trailing
// slash mismatch between SUPABASE_URL and the stored value.
const BUCKET_PATH_PREFIX = '/storage/v1/object/public/attachments/'
const MAX_LOGGED_URL_LENGTH = 200

// Truncate before logging: attachmentUrl is client-supplied and a rejected
// value could be arbitrarily large (e.g. a data: URL), so this keeps the
// warning cheap and log-friendly without dumping the whole payload.
function truncateForLog(url: string): string {
  return url.length > MAX_LOGGED_URL_LENGTH ? `${url.slice(0, MAX_LOGGED_URL_LENGTH)}…` : url
}

export function isValidAttachmentUrl(url: string): boolean {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) {
    // Already warned once at startup (see index.ts) if this is a genuine
    // misconfiguration — avoid re-warning on every rejected attachment.
    return false
  }

  let expectedOrigin: string
  try {
    expectedOrigin = new URL(supabaseUrl).origin
  } catch {
    console.warn(`Rejected attachmentUrl: SUPABASE_URL ("${supabaseUrl}") is not a valid URL`)
    return false
  }

  let candidate: URL
  try {
    candidate = new URL(url)
  } catch {
    console.warn(`Rejected attachmentUrl (not a valid URL): ${truncateForLog(url)}`)
    return false
  }

  const expectedPrefix = `${expectedOrigin}${BUCKET_PATH_PREFIX}`
  const valid = candidate.origin === expectedOrigin && candidate.pathname.startsWith(BUCKET_PATH_PREFIX)
  if (!valid) {
    console.warn(`Rejected attachmentUrl (expected prefix ${expectedPrefix}): ${truncateForLog(url)}`)
  }
  return valid
}
