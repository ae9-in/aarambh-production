import { NextResponse, type NextRequest } from "next/server"
import { requireAdmin, requireOrgMatch } from "@/lib/api-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeObject } from "@/lib/sanitize"

type ReindexBody = {
  orgId?: string
  categoryId?: string | null
  limit?: number
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    const body = sanitizeObject((await req.json().catch(() => ({}))) as ReindexBody)
    const orgId = String(body.orgId || auth.orgId || "")
    const categoryId = body.categoryId ? String(body.categoryId) : null
    const limit = Math.max(1, Math.min(Number(body.limit || 100), 500))

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    }
    await requireOrgMatch(auth.id, orgId)

    let query = supabaseAdmin
      .from("content")
      .select("id,org_id,type,file_url,title")
      .eq("org_id", orgId)
      .eq("is_published", true)
      .in("type", ["PDF", "NOTE", "PPT", "VIDEO"])
      .order("created_at", { ascending: false })
      .limit(limit)

    if (categoryId) query = query.eq("category_id", categoryId)

    const { data: contentRows, error } = await query
    if (error) {
      console.error("reindex: content query error", error)
      return NextResponse.json({ error: "Failed to list content" }, { status: 500 })
    }

    const rows = contentRows || []
    const origin = req.nextUrl.origin
    let success = 0
    let failed = 0
    const failures: Array<{ contentId: string; reason: string }> = []

    for (const row of rows as any[]) {
      try {
        const embedRes = await fetch(`${origin}/api/ai/embed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-embed-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
          },
          body: JSON.stringify({
            contentId: row.id,
            orgId,
            fileUrl: row.file_url || null,
            fileName: `${String(row.title || "lesson")}.${String(row.type || "").toLowerCase()}`,
          }),
        })
        if (!embedRes.ok) {
          failed += 1
          const txt = await embedRes.text().catch(() => "embed failed")
          failures.push({ contentId: String(row.id), reason: txt.slice(0, 180) })
        } else {
          success += 1
        }
      } catch (e: any) {
        failed += 1
        failures.push({ contentId: String(row.id), reason: String(e?.message || "unknown error") })
      }
    }

    return NextResponse.json({
      success: true,
      orgId,
      total: rows.length,
      reindexed: success,
      failed,
      failures: failures.slice(0, 10),
    })
  } catch (e) {
    console.error("reindex route error:", e)
    return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 500 })
  }
}

