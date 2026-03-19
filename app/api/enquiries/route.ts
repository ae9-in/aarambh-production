import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sanitizeObject, validateEmail, containsHtml } from "@/lib/sanitize"
import { requireAdmin } from "@/lib/api-auth"
import { checkRateLimit, getIpFromRequestHeaders } from "@/lib/rate-limit"

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
    const rawBody = await req.json().catch(() => null)
    const body = sanitizeObject(rawBody ?? {})
    const allowedFields = new Set(["name", "email", "phone", "company", "team_size", "teamSize", "message"])
    const extraFields = Object.keys(body as Record<string, unknown>).filter((k) => !allowedFields.has(k))
    if (extraFields.length > 0) {
      return NextResponse.json({ error: `Unexpected fields: ${extraFields.join(", ")}` }, { status: 400 })
    }

    const ip = getIpFromRequestHeaders(req.headers)
    const limit = checkRateLimit({ key: `enquiries:${ip}`, limit: 5, windowMs: 60 * 60 * 1000 })
    if (!limit.success) {
      const res = NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
      res.headers.set("Retry-After", String(limit.retryAfterSeconds))
      return res
    }

    const name = body?.name?.toString().trim()
    const email = body?.email?.toString().trim()
    const phone = body?.phone?.toString().trim() ?? ""
    const company = body?.company?.toString().trim() || null
    const teamSize = (body as any)?.team_size?.toString().trim() || body?.teamSize?.toString().trim() || null
    const message = body?.message?.toString().trim() || null

    if (!name || !email || !phone) {
      return NextResponse.json(
        { error: "Name, email and phone are required." },
        { status: 400 },
      )
    }
    if (name.length < 1 || name.length > 100) {
      return NextResponse.json({ error: "Name must be between 1 and 100 characters." }, { status: 400 })
    }
    if (!validateEmail(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 })
    }
    if (!/^\d{7,15}$/.test(phone)) {
      return NextResponse.json({ error: "Phone must be numeric and 7-15 digits." }, { status: 400 })
    }
    if (company && company.length > 120) {
      return NextResponse.json({ error: "Company is too long." }, { status: 400 })
    }
    if (message && message.length > 5000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 })
    }
    const htmlFields = [name, email, phone, company || "", teamSize || "", message || ""]
    if (htmlFields.some((f) => containsHtml(String(f)))) {
      return NextResponse.json({ error: "HTML/script content is not allowed." }, { status: 400 })
    }

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

    return NextResponse.json({ success: true, enquiry })
  } catch (e) {
    console.error("enquiries POST error", e)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const admin = freshAdmin()
  try {
    await requireAdmin(req)
    const { searchParams } = req.nextUrl
    const status = searchParams.get("status")
    const countOnly = searchParams.get("count") === "true"

    let query = admin.from("enquiries").select("*", { count: "exact" })

    if (status) {
      query = query.eq("status", status)
    }

    query = query.order("created_at", { ascending: false })

    const { data, error, count } = await query

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
    console.error("enquiries GET route error", e)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    )
  }
}

