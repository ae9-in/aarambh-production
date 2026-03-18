import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createEmbedding } from '@/lib/openai'
import Groq from 'groq-sdk'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'
import { randomUUID } from 'crypto'

type ChatRequestBody = {
  question?: string
  userId?: string
  orgId?: string
  userRole?: string
  sessionId?: string
  categoryId?: string | null
}

const groqApiKey = process.env.GROQ_API_KEY
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody
    const { question, userId, orgId, userRole, sessionId: incomingSessionId, categoryId } = body

    // 1. Validate inputs
    if (!question || !question.trim() || !userId || !orgId) {
      return NextResponse.json(
        { error: 'Missing question, userId, or orgId' },
        { status: 400 },
      )
    }

    // 2-5. Retrieval pipeline (embedding + vector search + access filtering).
    let chunks: any[] = []
    let retrievalIssue: string | null = null
    const wantsPerformerDetails = /performer|top performer|leaderboard|rank|best/i.test(question)
    let performerContext = ""
    try {
      const questionEmbedding = await createEmbedding(question, 'RETRIEVAL_QUERY')

      // Resolve category access for this user.
      let accessibleCategoryIds: string[] | null = null
      const { data: categoryRows, error: categoryError } = await supabaseAdmin.rpc(
        'get_accessible_categories',
        {
          p_user_id: userId,
          p_org_id: orgId,
        },
      )

      if (!categoryError && Array.isArray(categoryRows)) {
        accessibleCategoryIds = categoryRows.map((r: { category_id: string }) => r.category_id)
      } else {
                    // Fallback for environments where get_accessible_categories is unavailable.
                    accessibleCategoryIds = await getAccessibleCategoryIdsForUser(
                      orgId,
                      userId,
                      userRole || 'EMPLOYEE',
                    )
      }

      if (categoryId) {
        accessibleCategoryIds = (accessibleCategoryIds || []).filter((id) => id === categoryId)
      }

      // Optional: include top quiz performer details in the system prompt.
      // We keep this conditional so chat latency doesn't always increase.
      if (wantsPerformerDetails && accessibleCategoryIds && accessibleCategoryIds.length > 0) {
        const relevantCategoryIds = accessibleCategoryIds

        const { data: contentRows, error: contentErr } = await supabaseAdmin
          .from("content")
          .select("id, category_id")
          .eq("org_id", orgId)
          .in("category_id", relevantCategoryIds)

        if (!contentErr && contentRows && contentRows.length > 0) {
          const contentIds = [...new Set(contentRows.map((r: any) => r.id).filter(Boolean))]

          const { data: quizzes, error: quizErr } = await supabaseAdmin
            .from("quizzes")
            .select("id, content_id")
            .in("content_id", contentIds)

          if (!quizErr && quizzes && quizzes.length > 0) {
            const quizIds = [...new Set(quizzes.map((q: any) => q.id).filter(Boolean))]

            const { data: attempts, error: attemptsErr } = await supabaseAdmin
              .from("quiz_attempts")
              .select("user_id, score, passed")
              .in("quiz_id", quizIds)
              .limit(20000)

            if (!attemptsErr && attempts) {
              const statsByUser = new Map<
                string,
                { scoreSum: number; passCount: number; attempts: number }
              >()

              for (const a of attempts as any[]) {
                if (!a.user_id) continue
                const prev = statsByUser.get(a.user_id) ?? { scoreSum: 0, passCount: 0, attempts: 0 }
                prev.scoreSum += typeof a.score === "number" ? a.score : Number(a.score ?? 0)
                prev.passCount += a.passed ? 1 : 0
                prev.attempts += 1
                statsByUser.set(a.user_id, prev)
              }

              const topUsers = [...statsByUser.entries()]
                .map(([user_id, s]) => ({
                  user_id,
                  avg_score: s.attempts > 0 ? s.scoreSum / s.attempts : 0,
                  pass_rate: s.attempts > 0 ? s.passCount / s.attempts : 0,
                  attempts: s.attempts,
                }))
                .sort((a, b) => b.avg_score - a.avg_score)
                .slice(0, 3)

              const topUserIds = topUsers.map((t) => t.user_id)
              const { data: profiles } = await supabaseAdmin
                .from("profiles")
                .select("id, name")
                .in("id", topUserIds)

              const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]))
              const lines = topUsers.map((t, idx) => {
                const name = nameById.get(t.user_id) ?? "Unknown"
                const avg = Number(t.avg_score.toFixed(2))
                const pass = Number((t.pass_rate * 100).toFixed(1))
                return `${idx + 1}) ${name} - Avg quiz score: ${avg}, Pass rate: ${pass}%`
              })

              performerContext = lines.join("\n")
            }
          }
        }
      }

      const {
        data: matchedChunks,
        error: matchError,
      } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: questionEmbedding,
        match_count: 20,
        filter_org_id: orgId,
        filter_role: userRole || 'EMPLOYEE',
      })

      if (matchError) {
        console.error('chat: match_documents error', matchError)
      }

      chunks = Array.isArray(matchedChunks) ? [...matchedChunks] : []

      // Enforce category access for BOTH lesson chunks (content_id) and Q&A chunks (qna_id).
      if (chunks.length > 0 && accessibleCategoryIds && accessibleCategoryIds.length > 0) {
        const chunkIds = [...new Set(chunks.map((c: any) => c.id).filter(Boolean))]

        const { data: chunkMetaRows } = await supabaseAdmin
          .from('ai_chunks')
          .select('id, content_id, source_type, qna_id')
          .in('id', chunkIds)

        const chunkMeta = new Map<
          string,
          { content_id: string | null; source_type: string | null; qna_id: string | null }
        >(
          (chunkMetaRows || []).map((r: any) => [
            r.id,
            {
              content_id: (r.content_id as string | null) ?? null,
              source_type: (r.source_type as string | null) ?? null,
              qna_id: (r.qna_id as string | null) ?? null,
            },
          ]),
        )

        const lessonContentIds = [...new Set(chunks.map((c: any) => c.content_id).filter(Boolean))]
        const qnaIds = [...new Set(chunks.map((c: any) => chunkMeta.get(c.id)?.qna_id).filter(Boolean))]

        const { data: contentRows } = await supabaseAdmin
          .from('content')
          .select('id, category_id')
          .in('id', lessonContentIds)

        const { data: qnaRows } = await supabaseAdmin
          .from('ai_qna_entries')
          .select('id, category_id')
          .in('id', qnaIds)

        const allowedContent = new Set(
          (contentRows || [])
            .filter((row: any) => {
              const catId = row.category_id as string | null
              return Boolean(catId && accessibleCategoryIds?.includes(catId))
            })
            .map((row: any) => row.id as string),
        )

        const allowedQna = new Set(
          (qnaRows || [])
            .filter((row: any) => {
              const catId = row.category_id as string | null
              return Boolean(catId && accessibleCategoryIds?.includes(catId))
            })
            .map((row: any) => row.id as string),
        )

        chunks = chunks.filter((c: any) => {
          const meta = chunkMeta.get(c.id)
          if (!meta) return false

          if (meta.content_id) return allowedContent.has(meta.content_id)
          if (meta.qna_id) return allowedQna.has(meta.qna_id)
          return false
        })
      }
      chunks = chunks.slice(0, 8)
    } catch (retrievalError) {
      console.error('chat: retrieval pipeline error', retrievalError)
      retrievalIssue = 'Knowledge retrieval is temporarily unavailable.'
      chunks = []
    }

    // 6. Build context
    const context =
      chunks && Array.isArray(chunks) && chunks.length
        ? chunks.map((c: any) => c.chunk_text).join('\n\n---\n\n')
        : ''

    // 7. Create session if needed
    // If the user doesn't exist in `profiles` yet, session insert will fail due to FK constraint.
    // In that case we still stream the answer (but we skip persisting chat history).
    let sessionId = incomingSessionId ?? null
    let persistChat = true
    if (!sessionId) {
      try {
        const { data: session, error: sessionError } = await supabaseAdmin
          .from('ai_chat_sessions')
          .insert({
            user_id: userId,
            org_id: orgId,
          })
          .select('id')
          .single()

        if (sessionError || !session) {
          console.error('chat: session create error', sessionError)
          persistChat = false
          sessionId = `temp-${randomUUID()}`
        } else {
          sessionId = session.id as string
        }
      } catch (e) {
        console.error('chat: session create exception', e)
        persistChat = false
        sessionId = `temp-${randomUUID()}`
      }
    }

    // 8. Save user message
    if (persistChat) {
      const { error: msgError } = await supabaseAdmin.from('ai_chat_messages').insert({
        session_id: sessionId,
        role: 'user',
        content: question,
      })

      if (msgError) {
        console.error('chat: user message insert error', msgError)
      }
    }

    const encoder = new TextEncoder()
    let fullText = ''
    const sourceIds =
      chunks && Array.isArray(chunks)
        ? chunks
            .map((c: any) => c.content_id)
            .filter(Boolean)
        : []

    // 9. If nothing relevant is found, stream a grounded fallback immediately.
    if (!context.trim()) {
      fullText = retrievalIssue
        ? `${retrievalIssue} Please try again in a moment.`
        : "This topic is not covered in your current training materials. Try asking within a specific category you have access to, like Web Development, Sales, or Marketing."

      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const words = fullText.split(' ')
          for (const word of words) {
            controller.enqueue(encoder.encode(`${word} `))
            await new Promise((resolve) => setTimeout(resolve, 20))
          }

          if (persistChat) {
            const { error: saveError } = await supabaseAdmin.from('ai_chat_messages').insert({
              session_id: sessionId,
              role: 'assistant',
              content: fullText.trim(),
              sources: sourceIds,
            })

            if (saveError) {
              console.error('chat: assistant fallback insert error', saveError)
            }
          }

          controller.close()
        },
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'x-chat-session-id': String(sessionId),
        },
      })
    }

    // 10. Stream completion from Groq
    if (!groq) {
      const encoder = new TextEncoder()
      const fullText = 'AI generation is temporarily unavailable. `GROQ_API_KEY` is missing on the server.'

      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const words = fullText.split(' ')
            for (const word of words) {
              controller.enqueue(encoder.encode(`${word} `))
              await new Promise((resolve) => setTimeout(resolve, 20))
            }
          } finally {
            controller.close()
          }
        },
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'x-chat-session-id': String(sessionId),
        },
      })
    }

    const stream = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 900,
      stream: true,
      messages: [
        {
          role: 'system',
          content: `You are Arambh AI, a senior training assistant.

Use ONLY the company training content provided below.
- If the user asks something outside this content, respond exactly:
"This topic is not covered in your current training materials."
- Keep answers detailed, practical, and encouraging.
- Output clean Markdown, with proper spacing:
  - Use short headings (## or ###) for sections
  - Put each bullet on a new line
  - Use numbered lists for step-by-step instructions
  - Add blank lines between paragraphs and sections
  - Do not dump one giant paragraph
- Do not invent facts beyond the provided training content.

${wantsPerformerDetails && performerContext ? `Top quiz performers (from quiz activity):\n${performerContext}\n\nWhen you answer, show a short "Top performers" section at the top using only these details.\n` : ""}

Training Content:
${context}`,
        },
        { role: 'user', content: question },
      ],
    })

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices?.[0]?.delta?.content || ''
            if (text) {
              fullText += text
              controller.enqueue(encoder.encode(text))
            }
          }

          // If the model streamed nothing, still return a visible grounded response.
          if (!fullText.trim()) {
            const fallback =
              'This topic is not covered in your current training materials. Try asking within a specific category you have access to, like Web Development, Sales, or Marketing.'
            fullText = fallback
            controller.enqueue(encoder.encode(fallback))
          }

          if (persistChat) {
            const { error: saveError } = await supabaseAdmin
              .from('ai_chat_messages')
              .insert({
                session_id: sessionId,
                role: 'assistant',
                content: fullText,
                sources: sourceIds,
              })

            if (saveError) {
              console.error('chat: assistant message insert error', saveError)
            }
          }

          controller.close()
        } catch (e) {
          console.error('chat: stream error', e)
          controller.error(e)
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'x-chat-session-id': String(sessionId),
      },
    })
  } catch (e) {
    console.error('chat route error:', e)
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Internal error',
      },
      { status: 500 },
    )
  }
}

