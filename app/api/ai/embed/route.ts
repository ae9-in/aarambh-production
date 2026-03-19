import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireAdmin, requireOrgMatch } from "@/lib/api-auth"
import { chunkText, extractText } from "@/lib/openai"
import { createEmbedding } from "@/lib/ai-config"

type EmbedRequestBody = {
  contentId?: string
  fileUrl?: string | null
  orgId?: string
  contentTitle?: string | null
  contentDescription?: string | null
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

function shouldExtractFromFile(fileUrl: string, type: string) {
  const lower = fileUrl.toLowerCase()
  if (type === "VIDEO" || type === "AUDIO") return false
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt") ||
    lower.includes("/raw/upload/")
  )
}

function inferMimeAndName(fileUrl: string): { mime: string; name: string } {
  const clean = fileUrl.split("?")[0]
  const name = clean.split("/").pop() || "document"
  const ext = (name.split(".").pop() || "").toLowerCase()
  if (ext === "pdf") return { mime: "application/pdf", name }
  if (ext === "docx")
    return {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      name,
    }
  if (ext === "doc") return { mime: "application/msword", name }
  if (ext === "pptx")
    return {
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name,
    }
  if (ext === "ppt") return { mime: "application/vnd.ms-powerpoint", name }
  return { mime: "application/octet-stream", name }
}

export async function POST(req: NextRequest) {
  try {
    const internalKey = req.headers.get("x-internal-embed-key")
    const isInternalCall =
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
      internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY
    const auth = isInternalCall ? null : await requireAdmin(req)

    const body = ((await req.json().catch(() => null)) || {}) as EmbedRequestBody
    const contentId = normalizeText(body.contentId)
    const orgId = normalizeText(body.orgId)
    const fileUrl = normalizeText(body.fileUrl)
    const contentTitle = normalizeText(body.contentTitle)
    const contentDescription = normalizeText(body.contentDescription)

    if (!contentId || !orgId) {
      return NextResponse.json(
        { error: "Missing contentId or orgId" },
        { status: 400 },
      )
    }
    if (!isInternalCall && auth?.id) {
      await requireOrgMatch(auth.id, orgId)
    }

    const { data: content, error: contentError } = await supabaseAdmin
      .from("content")
      .select("id, org_id, category_id, title, description, type, categories(name)")
      .eq("id", contentId)
      .single()

    if (contentError || !content) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 })
    }

    const lessonType = normalizeText(content.type).toUpperCase()
    const dbTitle = normalizeText(content.title) || contentTitle
    const dbDescription = normalizeText(content.description) || contentDescription
    const categoryName = normalizeText((content as any)?.categories?.name)

    let sourceText = ""
    if (fileUrl && shouldExtractFromFile(fileUrl, lessonType)) {
      try {
        const fileRes = await fetch(fileUrl)
        if (fileRes.ok) {
          const buffer = Buffer.from(await fileRes.arrayBuffer())
          const { mime, name } = inferMimeAndName(fileUrl)
          sourceText = await extractText(buffer, mime, name)
        }
      } catch (error) {
        console.error("embed file extraction error:", error)
      }
    }

    if (!sourceText.trim()) {
      sourceText = `This lesson is about: ${dbTitle || "Untitled lesson"}. ${
        dbDescription || "No description provided."
      }${categoryName ? ` Category: ${categoryName}.` : ""}`
    }

    const chunks = chunkText(sourceText, 400)
    const finalChunks = chunks.length > 0 ? chunks : [sourceText]

    const { error: deleteError } = await supabaseAdmin
      .from("ai_chunks")
      .delete()
      .eq("content_id", contentId)
    if (deleteError) {
      console.error("embed delete old chunks error:", deleteError)
    }

    let successCount = 0
    for (let i = 0; i < finalChunks.length; i += 1) {
      const chunk = finalChunks[i]
      const embedding = await createEmbedding(chunk)
      if (!embedding) {
        console.error(`embed skipped chunk ${i}: embedding failed`)
        continue
      }

      const { error: insertError } = await supabaseAdmin.from("ai_chunks").insert({
        content_id: contentId,
        org_id: orgId,
        source_type: "lesson",
        chunk_text: chunk,
        chunk_index: i,
        token_count: chunk.split(/\s+/).filter(Boolean).length,
        embedding,
        allowed_roles: ["EMPLOYEE", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      })
      if (insertError) {
        console.error(`embed insert error for chunk ${i}:`, insertError)
        continue
      }
      successCount += 1
    }

    return NextResponse.json({
      contentId,
      chunksRequested: finalChunks.length,
      chunksEmbedded: successCount,
    })
  } catch (error) {
    console.error("embed route error:", error)
    return NextResponse.json({ error: "Embed failed" }, { status: 500 })
  }
}

