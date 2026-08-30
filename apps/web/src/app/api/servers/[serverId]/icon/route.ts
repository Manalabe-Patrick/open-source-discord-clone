import { NextResponse } from 'next/server'
import { prisma } from '@repo/database'
import { requireMembership } from '@/lib/requireMembership'
import { uploadImage, UploadValidationError } from '@/lib/supabase'

export async function POST(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params

  const result = await requireMembership(serverId)
  if ('error' in result) return result.error

  if (result.membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the server owner can change the icon' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let url: string
  try {
    url = await uploadImage(file, `server-icons/${serverId}`)
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  await prisma.server.update({ where: { id: serverId }, data: { icon: url } })

  return NextResponse.json({ icon: url }, { status: 200 })
}
