import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isValidAttachmentUrl } from './attachments'

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321'

describe('isValidAttachmentUrl', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL

  beforeEach(() => {
    process.env.SUPABASE_URL = TEST_SUPABASE_URL
  })

  afterEach(() => {
    process.env.SUPABASE_URL = originalSupabaseUrl
  })

  it('accepts a URL under the configured bucket prefix', () => {
    const url = `${TEST_SUPABASE_URL}/storage/v1/object/public/attachments/user-1/file.png`
    expect(isValidAttachmentUrl(url)).toBe(true)
  })

  it('rejects a URL pointing at a different host', () => {
    const url = 'https://third-party.example.com/storage/v1/object/public/attachments/file.png'
    expect(isValidAttachmentUrl(url)).toBe(false)
  })

  it('rejects a lookalike host that merely shares the configured URL as a string prefix', () => {
    // If this were a naive `url.startsWith(supabaseUrl + ...)` check, a host
    // like `127.0.0.1:54321.evil.com` would never literally match the fixed
    // "/storage/v1/..." suffix anyway, but a bare-origin-as-prefix check
    // (`url.startsWith(supabaseUrl)`) *would* be fooled by this. Assert the
    // origin comparison rejects it outright.
    const url = `${TEST_SUPABASE_URL}.evil.com/storage/v1/object/public/attachments/file.png`
    expect(isValidAttachmentUrl(url)).toBe(false)
  })

  it('rejects a URL whose host is embedded later in the path rather than as the actual origin', () => {
    const url = `https://evil.com/${TEST_SUPABASE_URL}/storage/v1/object/public/attachments/file.png`
    expect(isValidAttachmentUrl(url)).toBe(false)
  })

  it('rejects a same-origin URL outside the attachments bucket path', () => {
    const url = `${TEST_SUPABASE_URL}/storage/v1/object/public/avatars/file.png`
    expect(isValidAttachmentUrl(url)).toBe(false)
  })

  it('returns false for any URL when SUPABASE_URL is unset', () => {
    process.env.SUPABASE_URL = ''
    const url = `${TEST_SUPABASE_URL}/storage/v1/object/public/attachments/file.png`
    expect(isValidAttachmentUrl(url)).toBe(false)
  })

  it('rejects a data: URL', () => {
    expect(isValidAttachmentUrl('data:image/png;base64,aGVsbG8=')).toBe(false)
  })

  it('rejects a javascript: URL', () => {
    expect(isValidAttachmentUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects a malformed/unparseable URL', () => {
    expect(isValidAttachmentUrl('not a url')).toBe(false)
  })
})
