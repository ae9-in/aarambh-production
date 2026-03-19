import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createEmbedding, chunkText, extractText } from '@/lib/openai'
import { requireAdmin, requireOrgMatch } from '@/lib/api-auth'
import { sanitizeObject } from '@/lib/sanitize'

type EmbedRequestBody = {
  contentId?: string
  fileUrl?: string | null
  orgId?: string
  fileName?: string | null
  mimeType?: string | null
}

const BATCH_SIZE = 3
const BATCH_DELAY_MS = 300

export async function POST(req: NextRequest) {
  try {
    const internalKey = req.headers.get('x-internal-embed-key')
    const isInternalCall =
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
      internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY

    const auth = isInternalCall ? null : await requireAdmin(req)
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 415 })
    }
    const contentLength = Number(req.headers.get("content-length") || "0")
    if (contentLength > 10240) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 413 })
    }
    const body = sanitizeObject((await req.json()) as EmbedRequestBody)
    const { contentId, fileUrl, orgId, fileName, mimeType } = body

    if (!contentId || !orgId) {
      return NextResponse.json({ error: 'Missing contentId or orgId' }, { status: 400 })
    }
    if (!isInternalCall && auth?.id) {
      await requireOrgMatch(auth.id, orgId)
    }

    // 1. Get content record for mime type + filename
    const { data: content, error: contentError } = await supabaseAdmin
      .from('content')
      .select('id, org_id, category_id, title, description, type')
      .eq('id', contentId)
      .single()

    if (contentError || !content) {
      console.error('embed: content fetch error', contentError)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 })
    }

    const mime = mimeType ?? 'application/octet-stream'
    const name = fileName ?? `${(content.type as string | null)?.toLowerCase() || 'file'}`

    // 2. Build source text
    const lessonType = String((content.type as string | null) || '').toUpperCase()
    let text = ''
    if (lessonType === 'VIDEO') {
      const title = String((content.title as string | null) || '').trim()
      const description = String((content.description as string | null) || '').trim()
      text = [title, description].filter(Boolean).join('\n\n')
    } else if (fileUrl) {
      // For file lessons, fetch file and extract text.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      const res = await fetch(fileUrl, { signal: controller.signal }).catch((e) => {
        console.error("embed: file fetch error", e)
        return null as any
      })
      clearTimeout(timeout)
      if (!res || !res.ok) {
        console.error('embed: failed to fetch file', res?.status, res?.statusText)
        return NextResponse.json({ error: 'Failed to fetch file' }, { status: 400 })
      }
      if (!res.ok) {
        console.error('embed: failed to fetch file', res.status, res.statusText)
        return NextResponse.json({ error: 'Failed to fetch file' }, { status: 400 })
      }
      const buf = Buffer.from(await res.arrayBuffer())
      text = await extractText(buf, mime, name)
    }

    // Fallback to metadata text for unsupported/extraction-failed files.
    if (!text.trim()) {
      const title = String((content.title as string | null) || '').trim()
      const description = String((content.description as string | null) || '').trim()
      text = [title, description].filter(Boolean).join('\n\n')
    }

    // 4. If no text → return { skipped: true }
    if (!text || !text.trim()) {
      return NextResponse.json({ skipped: true })
    }

    // 5. Chunk text
    let chunks = chunkText(text, 400)
    if (!chunks.length && text.trim()) {
      // For short lesson metadata (common in video content), store a single chunk.
      chunks = [text.trim()]
    }

    if (!chunks.length) {
      return NextResponse.json({ skipped: true })
    }

    // 6. Delete existing chunks for this content
    const { error: deleteError } = await supabaseAdmin
      .from('ai_chunks')
      .delete()
      .eq('content_id', contentId)

    if (deleteError) {
      console.error('embed: delete ai_chunks error', deleteError)
    }

    // 7. Create embeddings and store in ai_chunks (batched)
    let allowedRoles = ['EMPLOYEE', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
    const categoryId = (content.category_id as string | null) ?? null
    if (categoryId) {
      const { data: accessRule } = await supabaseAdmin
        .from('category_access')
        .select('allowed_roles')
        .eq('org_id', orgId)
        .eq('category_id', categoryId)
        .maybeSingle()

      const configuredRoles = (accessRule?.allowed_roles as string[] | null) ?? []
      if (configuredRoles.length > 0) {
        allowedRoles = configuredRoles
      }
    }

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (chunk, idx) => {
          try {
            const embedding = await createEmbedding(chunk)
            const chunkIndex = i + idx

            const { error: insertError } = await supabaseAdmin.from('ai_chunks').insert({
              content_id: contentId,
              org_id: orgId,
              source_type: 'lesson',
              chunk_text: chunk,
              chunk_index: chunkIndex,
              token_count: chunk.split(' ').length,
              embedding,
              allowed_roles: allowedRoles,
            })

            if (insertError) {
              console.error('embed: ai_chunks insert error', insertError)
            }
          } catch (e) {
            console.error('embed: embedding error', e)
          }
        }),
      )

      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }

    // 8. Return summary
    return NextResponse.json({ chunksCreated: chunks.length })
  } catch (e) {
    console.error('embed route error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

