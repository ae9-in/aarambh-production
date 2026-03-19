import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeObject, validateEmail } from "@/lib/sanitize"
import { getClientIp, loginLimiter } from "@/lib/rate-limiter"

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 415 })
    }
    const contentLength = Number(req.headers.get("content-length") || "0")
    if (contentLength > 10240) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 413 })
    }
    const ip = getClientIp(req.headers)
    const limited = loginLimiter(`login:${ip}`)
    if (limited) return limited

    const body = sanitizeObject((await req.json().catch(() => null)) ?? {})
    const email = body?.email?.toString().trim().toLowerCase()
    const password = body?.password?.toString()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 400 },
      )
    }
    if (!validateEmail(email)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 })
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.signInWithPassword({ email, password })

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
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
        { error: "Invalid email or password." },
        { status: 401 },
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
          error: "Invalid email or password.",
        },
        { status: 401 },
      )
    }

    if (profile.status === "inactive") {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
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
      { error: "An error occurred. Please try again." },
      { status: 500 },
    )
  }
}
