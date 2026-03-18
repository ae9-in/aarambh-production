import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createEmbedding, chunkText } from '@/lib/openai'

type QnaEmbedRequestBody = {
  qnaId?: string
  orgId?: string
}

const BATCH_SIZE = 3
const BATCH_DELAY_MS = 300

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QnaEmbedRequestBody
    const { qnaId, orgId } = body

    if (!qnaId || !orgId) {
      return NextResponse.json({ error: 'Missing qnaId or orgId' }, { status: 400 })
    }

    // 1. Fetch Q&A entry
    const { data: entry, error: qnaError } = await supabaseAdmin
      .from('ai_qna_entries')
      .select('id, org_id, category_id, question, answer')
      .eq('id', qnaId)
      .single()

    if (qnaError || !entry) {
      console.error('qna-embed: ai_qna_entries fetch error', qnaError)
      return NextResponse.json({ error: 'Q&A entry not found' }, { status: 404 })
    }

    if (entry.org_id !== orgId) {
      return NextResponse.json({ error: 'Org mismatch for Q&A entry' }, { status: 403 })
    }

    // 2. Build source text from question + answer
    const question = String((entry.question as string | null) || '').trim()
    const answer = String((entry.answer as string | null) || '').trim()
    const text = [question, answer].filter(Boolean).join('\n\n')

    if (!text || !text.trim()) {
      return NextResponse.json({ skipped: true })
    }

    // 3. Chunk text
    let chunks = chunkText(text, 400)
    if (!chunks.length && text.trim()) {
      chunks = [text.trim()]
    }

    if (!chunks.length) {
      return NextResponse.json({ skipped: true })
    }

    // 4. Delete existing chunks for this Q&A entry
    const { error: deleteError } = await supabaseAdmin
      .from('ai_chunks')
      .delete()
      .eq('qna_id', qnaId)

    if (deleteError) {
      console.error('qna-embed: delete ai_chunks error', deleteError)
    }

    // 5. Determine allowed roles based on category access, if any
    let allowedRoles = ['EMPLOYEE', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
    const categoryId = (entry.category_id as string | null) ?? null
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

    // 6. Create embeddings and store in ai_chunks (batched)
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (chunk, idx) => {
          try {
            const embedding = await createEmbedding(chunk)
            const chunkIndex = i + idx

            const { error: insertError } = await supabaseAdmin.from('ai_chunks').insert({
              content_id: null,
              org_id: orgId,
              qna_id: qnaId,
              source_type: 'qna',
              chunk_text: chunk,
              chunk_index: chunkIndex,
              token_count: chunk.split(' ').length,
              embedding,
              allowed_roles: allowedRoles,
            })

            if (insertError) {
              console.error('qna-embed: ai_chunks insert error', insertError)
            }
          } catch (e) {
            console.error('qna-embed: embedding error', e)
          }
        }),
      )

      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }

    return NextResponse.json({ chunksCreated: chunks.length })
  } catch (e) {
    console.error('qna-embed route error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

