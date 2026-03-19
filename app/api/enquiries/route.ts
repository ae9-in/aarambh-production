import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sanitizeObject, validateEnquiryInput } from "@/lib/sanitize"
import { requireAdmin, requireOrgMatch } from "@/lib/api-auth"
import { enquiriesWriteLimiter, generalApiLimiter, getClientIp } from "@/lib/rate-limiter"

function isResponseLike(value: unknown): value is NextResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in (value as any) &&
      "headers" in (value as any),
  )
}

function isMissingOrgIdColumn(error: any): boolean {
  const message = String(error?.message ?? "")
  return error?.code === "42703" || message.includes("column enquiries.org_id does not exist")
}

function freshAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  const admin = freshAdmin()
  try {
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Invalid content type." }, { status: 415 })
    }
    const contentLength = Number(req.headers.get("content-length") || "0")
    if (contentLength > 10240) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 })
    }
    const ip = getClientIp(req.headers)
    const limited = enquiriesWriteLimiter(`enquiries:${ip}`)
    if (limited) return limited

    const body = await req.json().catch(() => null)
    let valid: any
    try {
      valid = validateEnquiryInput(body)
    } catch (validationError: any) {
      return NextResponse.json(
        { error: "Invalid enquiry input.", field: validationError?.field, reason: validationError?.reason },
        { status: 400 },
      )
    }
    const sanitized = sanitizeObject(valid)
    const name = String(sanitized.name)
    const email = String(sanitized.email)
    const phone = String(sanitized.phone)
    const company = sanitized.company ? String(sanitized.company) : null
    const message = sanitized.message ? String(sanitized.message) : null
    const teamSize = (body as any)?.team_size ? String((body as any).team_size).trim() : null

    // Basic org selection: use the first organization as the primary org
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (orgError) {
      console.error("enquiries org lookup error", orgError)
    }

    const orgId = org?.id ?? null

    const { data: enquiry, error } = await admin
      .from("enquiries")
      .insert({
        name,
        email,
        phone,
        company,
        team_size: teamSize,
        message,
        status: "new",
      })
      .select("*")
      .single()

    if (error) {
      console.error("enquiries insert error", error)
      return NextResponse.json(
        { error: "Failed to create enquiry." },
        { status: 500 },
      )
    }

    // Find any SUPER_ADMIN or ADMIN in the main org
    let adminUserId: string | null = null
    let adminOrgId: string | null = orgId

    const { data: adminProfile, error: adminError } = await admin
      .from("profiles")
      .select("id, org_id, role")
      .in("role", ["SUPER_ADMIN", "ADMIN"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (adminError) {
      console.error("enquiries admin lookup error", adminError)
    }

    if (adminProfile) {
      adminUserId = adminProfile.id as string
      adminOrgId = (adminProfile.org_id as string | null) ?? adminOrgId
    }

    if (adminUserId && adminOrgId) {
      const title = `📩 New Sales Enquiry from ${name}`
      const notifMessage = `${email}${company ? ` · ${company}` : ""}`

      const { error: notifError } = await admin.from("notifications").insert({
        user_id: adminUserId,
        org_id: adminOrgId,
        type: "system",
        title,
        message: notifMessage,
        action_url: "/dashboard/enquiries",
      })

      if (notifError) {
        console.error("enquiries notification insert error", notifError)
      }
    }

    return NextResponse.json({ success: true, id: enquiry.id })
  } catch (e) {
    console.error("enquiries POST error", e)
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const admin = freshAdmin()
  try {
    const auth = await requireAdmin(req).catch((e) => e)
    if (isResponseLike(auth)) return auth
    const globalLimited = generalApiLimiter(`api:${getClientIp(req.headers)}`)
    if (globalLimited) return globalLimited
    const { searchParams } = req.nextUrl
    const statusRaw = searchParams.get("status")
    const countOnly = searchParams.get("count") === "true"
    const orgIdParam = searchParams.get("orgId")
    const limitRaw = searchParams.get("limit")
    const createdAfterRaw = searchParams.get("created_after")
    const limitValue = Number(limitRaw ?? 20)
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 20

    const orgId = orgIdParam || auth.orgId
    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    }
    const orgCheck = await requireOrgMatch(auth.id, orgId).catch((e) => e)
    if (isResponseLike(orgCheck)) return orgCheck

    const allowedStatuses = new Set(["new", "contacted", "closed", "in_progress", "resolved"])
    const status = statusRaw && allowedStatuses.has(statusRaw) ? statusRaw : null

    let query = admin.from("enquiries").select("*", { count: "exact" }).eq("org_id", orgId)

    if (status) {
      query = query.eq("status", status)
    }
    if (createdAfterRaw) {
      const dt = new Date(createdAfterRaw)
      if (!Number.isNaN(dt.getTime())) {
        query = query.gt("created_at", dt.toISOString())
      }
    }

    query = query.order("created_at", { ascending: false }).limit(limit)

    let { data, error, count } = await query
    if (error && isMissingOrgIdColumn(error)) {
      let fallbackQuery = admin.from("enquiries").select("*", { count: "exact" })
      if (status) fallbackQuery = fallbackQuery.eq("status", status)
      if (createdAfterRaw) {
        const dt = new Date(createdAfterRaw)
        if (!Number.isNaN(dt.getTime())) {
          fallbackQuery = fallbackQuery.gt("created_at", dt.toISOString())
        }
      }
      fallbackQuery = fallbackQuery.order("created_at", { ascending: false }).limit(limit)
      const fallback = await fallbackQuery
      data = fallback.data
      error = fallback.error
      count = fallback.count
    }

    if (error) {
      console.error("enquiries GET error", error)
      return NextResponse.json(
        { error: "Failed to fetch enquiries." },
        { status: 500 },
      )
    }

    if (countOnly) {
      return NextResponse.json({ count: count ?? 0 })
    }

    return NextResponse.json({ enquiries: data ?? [], count: count ?? 0 })
  } catch (e) {
    if (isResponseLike(e)) return e
    console.error("enquiries GET route error", e)
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 },
    )
  }
}

