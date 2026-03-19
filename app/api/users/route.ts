import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/api-auth"
import { sanitizeObject, validateEmail } from "@/lib/sanitize"

function freshAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const admin = freshAdmin()
  try {
    await requireAdmin(req)

    const { searchParams } = req.nextUrl
    const status = searchParams.get("status")
    const countOnly = searchParams.get("count") === "true"

    let query = admin
      .from("profiles")
      .select("*, organizations(id, name)", { count: "exact" })

    if (status) {
      query = query.eq("status", status)
    }

    query = query.order("created_at", { ascending: false })

    const { data, error, count } = await query

    if (error) {
      console.error("users GET error:", error)
      return NextResponse.json(
        { error: "Failed to fetch users." },
        { status: 500 },
      )
    }

    if (countOnly) {
      return NextResponse.json({ count: count ?? 0 })
    }

    return NextResponse.json({ users: data ?? [], count: count ?? 0 })
  } catch (e) {
    console.error("users route error:", e)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const admin = freshAdmin()
  try {
    const caller = await requireAdmin(req)
    const body = sanitizeObject((await req.json().catch(() => null)) ?? {})
    const allowed = new Set(["name", "email", "password", "role", "status", "department", "phone"])
    const extra = Object.keys(body as Record<string, unknown>).filter((k) => !allowed.has(k))
    if (extra.length > 0) {
      return NextResponse.json({ error: `Unexpected fields: ${extra.join(", ")}` }, { status: 400 })
    }

    const name = String((body as any).name ?? "").trim()
    const email = String((body as any).email ?? "").trim().toLowerCase()
    const password = String((body as any).password ?? "")
    const role = String((body as any).role ?? "EMPLOYEE").toUpperCase()
    const status = String((body as any).status ?? "pending").toLowerCase()
    const department = (body as any).department ? String((body as any).department).trim() : null
    const phone = (body as any).phone ? String((body as any).phone).trim() : null

    if (!name || name.length > 100) {
      return NextResponse.json({ error: "Invalid name." }, { status: 400 })
    }
    if (!validateEmail(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
    }
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 })
    }
    if (!["active", "inactive", "pending"].includes(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 })
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    })
    if (createError || !created.user?.id) {
      return NextResponse.json({ error: createError?.message || "Failed to create user." }, { status: 500 })
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .upsert({
        id: created.user.id,
        name,
        email,
        role,
        status,
        department,
        phone,
        org_id: caller.orgId ?? null,
      })
      .select("*")
      .single()
    if (profileError) {
      return NextResponse.json({ error: "Failed to create profile." }, { status: 500 })
    }
    return NextResponse.json({ success: true, user: profile }, { status: 201 })
  } catch (e) {
    console.error("users POST error:", e)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
