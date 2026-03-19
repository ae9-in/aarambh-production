import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sanitizeObject } from "@/lib/sanitize"
import { requireAdmin } from "@/lib/api-auth"
import { generalApiLimiter, getClientIp } from "@/lib/rate-limiter"

function isResponseLike(value: unknown): value is NextResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in (value as any) &&
      "headers" in (value as any),
  )
}

function freshAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = freshAdmin()
  try {
    const limited = generalApiLimiter(`api:${getClientIp(req.headers)}`)
    if (limited) return limited
    const auth = await requireAdmin(req).catch((e) => e)
    if (isResponseLike(auth)) return auth
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    const body = sanitizeObject((await req.json().catch(() => null)) ?? {})
    const status = body?.status?.toString().trim()
    const notes = body?.notes?.toString().trim()

    if (!status && typeof notes === "undefined") {
      return NextResponse.json(
        { error: "Nothing to update." },
        { status: 400 },
      )
    }
    if (status && !["new", "contacted", "closed", "in_progress", "resolved"].includes(status)) {
      return NextResponse.json({ error: "Invalid status value." }, { status: 400 })
    }
    if (typeof notes === "string" && notes.length > 2000) {
      return NextResponse.json({ error: "Notes too long." }, { status: 400 })
    }
    const updatePayload: Record<string, unknown> = {}
    if (status) {
      updatePayload.status = status
    }
    if (typeof notes !== "undefined") {
      updatePayload.notes = notes
    }
    updatePayload.updated_at = new Date().toISOString()

    const { error } = await admin
      .from("enquiries")
      .update(updatePayload)
      .eq("id", id)

    if (error) {
      console.error("enquiries PATCH error", error)
      return NextResponse.json(
        { error: "Failed to update enquiry." },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    if (isResponseLike(e)) return e
    console.error("enquiries PATCH route error", e)
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 },
    )
  }
}

