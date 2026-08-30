import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@repo/database'
import { uploadImage, UploadValidationError } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let url: string
  try {
    url = await uploadImage(file, `avatars/${session.user.id}`)
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { image: url } })

  return NextResponse.json({ image: url }, { status: 200 })
}
