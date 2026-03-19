import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { createEmbedding, streamGroq } from "@/lib/ai-config"
import { requireAuth, requireOrgMatch } from "@/lib/api-auth"
import { aiChatLimiter } from "@/lib/rate-limiter"
import { getAccessibleCategoryIdsForUser } from "@/lib/category-access"

type ChatRequestBody = {
  question?: string
  userId?: string
  orgId?: string
  userRole?: string
  sessionId?: string | null
  categoryId?: string | null
}

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    const body = ((await req.json().catch(() => null)) || {}) as ChatRequestBody

    const question = String(body.question || "").trim()
    const userId = String(body.userId || "").trim()
    const orgId = String(body.orgId || "").trim()
    const userRole = String(body.userRole || "EMPLOYEE").trim()
    const categoryId = body.categoryId ? String(body.categoryId).trim() : null

    if (!question || !userId || !orgId) {
      return NextResponse.json(
        { error: "Missing question, userId, or orgId" },
        { status: 400 },
      )
    }
    if (auth.id !== userId) {
      return NextResponse.json({ error: "User mismatch" }, { status: 403 })
    }
    await requireOrgMatch(auth.id, orgId)
    const limited = aiChatLimiter(`ai-chat:${auth.id}`)
    if (limited) return limited

    const accessibleCategoryIds = await getAccessibleCategoryIdsForUser(
      orgId,
      userId,
      userRole || "EMPLOYEE",
    )
    if (categoryId && !accessibleCategoryIds.includes(categoryId)) {
      return NextResponse.json({ error: "Category access denied" }, { status: 403 })
    }

    const isCategorySummaryIntent = /explain what i learned in this category|what i learned|summary of this category|what did i learn/i.test(
      question.toLowerCase(),
    )

    let matchedChunks: any[] = []
    const questionEmbedding = await createEmbedding(question)
    if (questionEmbedding) {
      const rpcArgs: Record<string, any> = {
        query_embedding: questionEmbedding,
        match_count: 5,
        filter_org_id: orgId,
        filter_role: userRole || "EMPLOYEE",
      }
      if (categoryId) rpcArgs.filter_category_id = categoryId

      let matchError: any = null
      const rpcPrimary = await supabaseAdmin.rpc("match_documents", rpcArgs)
      matchedChunks = Array.isArray(rpcPrimary.data) ? rpcPrimary.data : []
      matchError = rpcPrimary.error

      // fallback for deployments where RPC doesn't accept filter_category_id
      if (matchError && categoryId) {
        const rpcFallback = await supabaseAdmin.rpc("match_documents", {
          query_embedding: questionEmbedding,
          match_count: 5,
          filter_org_id: orgId,
          filter_role: userRole || "EMPLOYEE",
        })
        matchedChunks = Array.isArray(rpcFallback.data) ? rpcFallback.data : []
        matchError = rpcFallback.error
      }

      if (matchError) {
        console.error("chat match_documents error:", matchError)
      }
    } else {
      console.warn("chat: embedding unavailable, using metadata fallback")
      const terms = tokenize(question).slice(0, 6)
      const keyword = terms[0] || ""
      let contentQuery = supabaseAdmin
        .from("content")
        .select("id,title,description,category_id")
        .eq("org_id", orgId)
        .eq("is_published", true)
        .limit(5)

      if (categoryId) {
        contentQuery = contentQuery.eq("category_id", categoryId)
      }
      if (keyword) {
        contentQuery = contentQuery.or(
          `title.ilike.%${keyword}%,description.ilike.%${keyword}%`,
        )
      }
      const { data: fallbackRows } = await contentQuery
      matchedChunks = (fallbackRows || []).map((row: any, i: number) => ({
        id: `fallback-${row.id}-${i}`,
        content_id: row.id,
        chunk_text: `Lesson: ${String(row.title || "").trim()}\n\nSummary: ${String(
          row.description || "",
        ).trim()}`,
      }))
    }

    // Strong fallback for "what I learned in this category" style questions:
    // summarize approved lessons from that category even when vector matches are weak.
    if (categoryId && (isCategorySummaryIntent || matchedChunks.length === 0)) {
      const { data: categoryLessons } = await supabaseAdmin
        .from("content")
        .select("id,title,description")
        .eq("org_id", orgId)
        .eq("category_id", categoryId)
        .eq("is_published", true)
        .order("created_at", { ascending: true })
        .limit(25)

      if (categoryLessons && categoryLessons.length > 0) {
        matchedChunks = categoryLessons.map((row: any, idx: number) => ({
          id: `cat-summary-${row.id}-${idx}`,
          content_id: row.id,
          chunk_text: `Lesson: ${String(row.title || "").trim()}\nSummary: ${String(
            row.description || "",
          ).trim() || "No summary provided."}`,
        }))
      }
    }

    // Access-safe fallback when no explicit category is passed.
    if (!categoryId && matchedChunks.length === 0 && accessibleCategoryIds.length > 0) {
      const { data: scopedLessons } = await supabaseAdmin
        .from("content")
        .select("id,title,description,category_id")
        .eq("org_id", orgId)
        .eq("is_published", true)
        .in("category_id", accessibleCategoryIds)
        .limit(8)
      if (scopedLessons && scopedLessons.length > 0) {
        matchedChunks = scopedLessons.map((row: any, idx: number) => ({
          id: `access-summary-${row.id}-${idx}`,
          content_id: row.id,
          chunk_text: `Lesson: ${String(row.title || "").trim()}\nSummary: ${String(
            row.description || "",
          ).trim() || "No summary provided."}`,
        }))
      }
    }

    const sourceContentIds = matchedChunks
      .map((c: any) => c.content_id)
      .filter(Boolean)
      .slice(0, 5)
    const context = matchedChunks
      .map((c: any) => String(c.chunk_text || "").trim())
      .filter(Boolean)
      .join("\n\n---\n\n")

    const systemPrompt = `You are an expert AI training assistant for this company.
Your job is to help employees understand their training materials clearly and in depth.
Answer every question in a detailed, structured, easy to understand way.
Use bullet points, numbered steps, and clear headings in your responses.
Be encouraging, professional, and thorough like a senior mentor explaining to a junior.
If the answer is in the training content below, use it to give accurate specific answers.
If the question is not covered in the training content, say this topic is not in your
current training materials and suggest they ask their manager or check other resources.
Never make up information that is not in the training content.
When the user asks what they learned in this category, summarize all available lessons in this category into:
- Key topics learned
- Practical skills gained
- Important points to remember
- Next recommended practice steps

Training Content Available:
${context || "No specific content found for this question."}`

    let sessionId = body.sessionId ? String(body.sessionId) : null
    if (!sessionId) {
      const sessionInsert = await supabaseAdmin
        .from("ai_chat_sessions")
        .insert({ user_id: userId, org_id: orgId })
        .select("id")
        .single()
      sessionId = sessionInsert.data?.id || `temp-${randomUUID()}`
    }

    await supabaseAdmin.from("ai_chat_messages").insert({
      session_id: sessionId,
      role: "user",
      content: question,
    })

    const groqStream = await streamGroq(systemPrompt, question)
    const encoder = new TextEncoder()
    let finalAnswer = ""

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of groqStream as any) {
            const delta = String(chunk?.choices?.[0]?.delta?.content || "")
            if (!delta) continue
            finalAnswer += delta
            controller.enqueue(encoder.encode(delta))
          }

          if (!finalAnswer.trim()) {
            finalAnswer =
              "This topic is not in your current training materials. Please ask your manager or check additional learning resources."
            controller.enqueue(encoder.encode(finalAnswer))
          }

          await supabaseAdmin.from("ai_chat_messages").insert({
            session_id: sessionId,
            role: "assistant",
            content: finalAnswer,
            sources: sourceContentIds,
          })

          controller.close()
        } catch (error) {
          console.error("chat stream error:", error)
          controller.error(error)
        }
      },
    })

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "x-chat-session-id": String(sessionId),
      },
    })
  } catch (error) {
    console.error("chat route error:", error)
    return NextResponse.json({ error: "AI chat failed" }, { status: 500 })
  }
}

