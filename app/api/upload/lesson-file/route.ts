import { NextResponse, type NextRequest } from 'next/server'
import { uploadToCloudinary, detectType, detectResourceType } from '@/lib/cloudinary'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const file = form.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const orgId = String(form.get('orgId') || '')
    const categoryId = String(form.get('categoryId') || '')
    const userId = String(form.get('userId') || '')

    if (!orgId || !userId) {
      return NextResponse.json(
        { error: 'Missing orgId or userId' },
        { status: 400 },
      )
    }

    const fileName = file.name
    const mimeType = file.type || 'application/octet-stream'
    const fileType = detectType(mimeType, fileName)

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const { secureUrl, publicId, resourceType } = await uploadToCloudinary(buffer, fileName, fileType)

    return NextResponse.json({
      url: secureUrl,
      publicId,
      resourceType,
      fileType,
      fileName,
      size: file.size,
    })
  } catch (e) {
    console.error('lesson-file upload route error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
