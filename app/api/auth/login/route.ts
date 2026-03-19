import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeObject, validateEmail } from "@/lib/sanitize"
import { checkRateLimit, getIpFromRequestHeaders } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  try {
    const ip = getIpFromRequestHeaders(req.headers)
    const limit = checkRateLimit({ key: `login:${ip}`, limit: 10, windowMs: 15 * 60 * 1000 })
    if (!limit.success) {
      const res = NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
      res.headers.set("Retry-After", String(limit.retryAfterSeconds))
      return res
    }

    const body = sanitizeObject((await req.json().catch(() => null)) ?? {})
    const email = body?.email?.toString().trim().toLowerCase()
    const password = body?.password?.toString()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      )
    }
    if (!validateEmail(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 })
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.signInWithPassword({ email, password })

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || "Invalid email or password." },
        { status: 401 },
      )
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*, organizations(id, name, logo_url, primary_color, plan)")
      .eq("id", authData.user.id)
      .single()

    if (profileError || !profile) {
      console.error("[login] profile query error:", profileError?.message)
      return NextResponse.json(
        { error: "Profile not found. Please contact support." },
        { status: 404 },
      )
    }

    // Auto-heal org_id for old users missing organization assignment.
    if (!profile.org_id) {
      let fallbackOrgId: string | null = null

      const { data: adminWithOrg } = await supabaseAdmin
        .from("profiles")
        .select("org_id")
        .in("role", ["SUPER_ADMIN", "ADMIN", "MANAGER"])
        .not("org_id", "is", null)
        .limit(1)
        .maybeSingle()

      if (adminWithOrg?.org_id) {
        fallbackOrgId = adminWithOrg.org_id as string
      } else {
        const { data: anyOrg } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .limit(1)
          .maybeSingle()
        fallbackOrgId = (anyOrg?.id as string) ?? null
      }

      if (fallbackOrgId) {
        await supabaseAdmin
          .from("profiles")
          .update({ org_id: fallbackOrgId, updated_at: new Date().toISOString() })
          .eq("id", profile.id)
        profile.org_id = fallbackOrgId
      }
    }

    if (profile.status === "pending") {
      return NextResponse.json(
        {
          error:
            "Your account is pending approval. Please wait for an administrator to approve your registration.",
        },
        { status: 403 },
      )
    }

    if (profile.status === "inactive") {
      return NextResponse.json(
        { error: "Your account has been deactivated. Please contact your administrator." },
        { status: 403 },
      )
    }

    const cookiePayload = JSON.stringify({
      id: profile.id,
      role: profile.role,
      orgId: profile.org_id ?? null,
    })

    const res = NextResponse.json({ profile })
    res.cookies.set("arambh_user", cookiePayload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 8,
    })

    return res
  } catch (e) {
    console.error("login route error:", e)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    )
  }
}
