import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey) : null

const ATTACHMENTS_BUCKET = 'attachments'
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024

// Thrown for caller-fixable problems (bad file type/size) so callers can map this to a 400;
// any other thrown error (misconfiguration, upstream failure) should map to a 500.
export class UploadValidationError extends Error {}

export async function uploadImage(file: File, pathPrefix: string): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error('Supabase Storage is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing)')
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new UploadValidationError('Only PNG, JPEG, GIF, and WebP images are allowed')
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new UploadValidationError('Image must be 8MB or smaller')
  }

  const extension = file.type.split('/')[1]
  const path = `${pathPrefix}/${Date.now()}.${extension}`

  const { error } = await supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  const { data } = supabaseAdmin.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
