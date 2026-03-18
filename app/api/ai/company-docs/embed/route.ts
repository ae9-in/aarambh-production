import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { chunkText, createEmbedding, extractText } from "@/lib/openai"

type EmbedRequestBody = {
  companyDocId?: string
  orgId?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as EmbedRequestBody
    const { companyDocId, orgId } = body

    if (!companyDocId || !orgId) {
      return NextResponse.json({ error: "Missing companyDocId or orgId" }, { status: 400 })
    }

    const { data: doc, error: docError } = await supabaseAdmin
      .from("company_documents")
      .select("id, org_id, doc_type, title, description, file_url, mime_type")
      .eq("id", companyDocId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (docError || !doc) {
      console.error("company-docs embed: doc fetch error", docError)
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    const fileUrl = doc.file_url
    if (!fileUrl) {
      return NextResponse.json({ skipped: true })
    }

    const mime = doc.mime_type || "application/pdf"
    const name = `${doc.title || "company-doc"}.pdf`

    const res = await fetch(fileUrl)
    if (!res.ok) {
      console.error("company-docs embed: failed to fetch file", res.status, res.statusText)
      return NextResponse.json({ error: "Failed to fetch file" }, { status: 400 })
    }

    const buf = Buffer.from(await res.arrayBuffer())
    let text = await extractText(buf, mime, name)

    if (!text.trim()) {
      text = [doc.title, doc.description].filter(Boolean).join("\n\n")
    }

    if (!text.trim()) {
      return NextResponse.json({ skipped: true })
    }

    // Add a stable marker so we can delete old embeddings for this specific doc.
    const marker = `COMPANY_DOC_ID:${companyDocId}`
    const textForEmbedding = `${marker}\n\n${text}`

    let chunks = chunkText(textForEmbedding, 400)
    if (!chunks.length) chunks = [textForEmbedding.trim()]

    // Remove existing chunks for this document (best-effort).
    const { error: deleteError } = await supabaseAdmin
      .from("ai_chunks")
      .delete()
      .eq("source_type", "policy")
      .ilike("chunk_text", `%${marker}%`)

    if (deleteError) {
      console.error("company-docs embed: delete error", deleteError)
    }

    const allowedRoles = ["EMPLOYEE", "MANAGER", "ADMIN", "SUPER_ADMIN"]

    // Embed in small batches to reduce load.
    const BATCH_SIZE = 3
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (chunk, idx) => {
          try {
            const embedding = await createEmbedding(chunk, "RETRIEVAL_DOCUMENT")
            await supabaseAdmin.from("ai_chunks").insert({
              content_id: null,
              org_id: orgId,
              source_type: "policy",
              qna_id: null,
              chunk_text: chunk,
              chunk_index: i + idx,
              token_count: chunk.split(" ").length,
              embedding,
              allowed_roles: allowedRoles,
            })
          } catch (e) {
            console.error("company-docs embed: insert/embedding error", e)
          }
        }),
      )
    }

    return NextResponse.json({ chunksCreated: chunks.length })
  } catch (e: any) {
    console.error("company-docs embed route error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

