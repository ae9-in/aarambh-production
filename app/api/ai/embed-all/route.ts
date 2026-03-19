import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireAdmin, requireOrgMatch } from "@/lib/api-auth"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    const orgId = String(req.nextUrl.searchParams.get("orgId") || auth.orgId || "")
    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    }
    await requireOrgMatch(auth.id, orgId)

    const { data: contentRows, error: contentError } = await supabaseAdmin
      .from("content")
      .select("id, org_id, file_url, title, description")
      .eq("org_id", orgId)
      .eq("is_published", true)
      .order("created_at", { ascending: true })

    if (contentError) {
      return NextResponse.json({ error: "Failed to load content" }, { status: 500 })
    }

    const allRows = contentRows || []
    const allIds = allRows.map((r: any) => r.id)
    const { data: existing } = await supabaseAdmin
      .from("ai_chunks")
      .select("content_id")
      .in("content_id", allIds.length ? allIds : ["00000000-0000-0000-0000-000000000000"])

    const existingSet = new Set((existing || []).map((r: any) => String(r.content_id)))
    const pending = allRows.filter((r: any) => !existingSet.has(String(r.id)))

    const encoder = new TextEncoder()
    const origin = req.nextUrl.origin
    let processed = 0

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(JSON.stringify({ total: pending.length, processed: 0 }) + "\n"),
          )
          for (const row of pending) {
            try {
              await fetch(`${origin}/api/ai/embed`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-embed-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
                },
                body: JSON.stringify({
                  contentId: row.id,
                  fileUrl: row.file_url,
                  orgId,
                  contentTitle: row.title,
                  contentDescription: row.description || row.title,
                }),
              })
            } catch (error) {
              console.error("embed-all item error:", error)
            }
            processed += 1
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ total: pending.length, processed, contentId: row.id }) + "\n",
              ),
            )
            await sleep(500)
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    console.error("embed-all route error:", error)
    return NextResponse.json({ error: "Embed-all failed" }, { status: 500 })
  }
}

