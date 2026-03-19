import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { uploadToCloudinary, detectType, detectResourceType } from '@/lib/cloudinary'

const EMBEDDABLE_TYPES = new Set(['PDF', 'NOTE', 'PPT', 'VIDEO'])

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
    const titleRaw = form.get('title')
    const descriptionRaw = form.get('description')
    const taskTextRaw = form.get('taskText')

    if (!orgId || !categoryId || !userId) {
      return NextResponse.json(
        { error: 'Missing orgId, categoryId, or userId' },
        { status: 400 },
      )
    }

    const fileName = file.name
    const mimeType = file.type || 'application/octet-stream'
    const fileType = detectType(mimeType, fileName)
    const resourceType = detectResourceType(mimeType, fileName)

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const { secureUrl, publicId } = await uploadToCloudinary(buffer, fileName, fileType)

    const inferredTitle =
      typeof titleRaw === 'string'
        ? titleRaw
        : fileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ')
    const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : ''
    const taskText = typeof taskTextRaw === 'string' ? taskTextRaw.trim() : ''

    let insertPayload: Record<string, unknown> = {
      org_id: orgId,
      category_id: categoryId,
      title: inferredTitle,
      description: description || null,
      task_text: taskText || null,
      type: fileType,
      file_url: secureUrl,
      cloudinary_public_id: publicId,
      cloudinary_resource_type: resourceType,
      file_size: file.size,
      uploaded_by: userId,
      is_published: true,
    }

    let data: any = null
    let error: any = null
    const optionalColumns = new Set(['task_text', 'cloudinary_public_id', 'cloudinary_resource_type'])

    // Production-safe fallback: if optional columns are missing in DB schema cache, retry without them.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await supabaseAdmin.from('content').insert(insertPayload).select('*').single()
      data = res.data
      error = res.error
      if (!error || data) break

      const missingColumnMatch = /'([^']+)' column/.exec(String(error?.message || ''))
      const missingColumn = missingColumnMatch?.[1]
      if (!missingColumn || !optionalColumns.has(missingColumn) || !(missingColumn in insertPayload)) {
        break
      }
      delete insertPayload[missingColumn]
      console.warn(`upload route: retrying insert without optional column '${missingColumn}'`)
    }

    if (error || !data) {
      console.error('upload insert error:', error)
      return NextResponse.json({ error: 'Failed to save content' }, { status: 400 })
    }

    if (EMBEDDABLE_TYPES.has(fileType)) {
      const origin = req.nextUrl.origin
      fetch(`${origin}/api/ai/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-embed-key': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        },
        body: JSON.stringify({
          contentId: data.id,
          fileUrl: secureUrl,
          orgId,
          fileName,
          mimeType,
        }),
      }).catch(e => {
        console.error('embed trigger error:', e)
      })
    }

    return NextResponse.json({ content: data }, { status: 201 })
  } catch (e) {
    console.error('upload route error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid request body' },
      { status: 400 },
    )
  }
}

