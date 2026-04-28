import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import isEmail from "validator/lib/isEmail"
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

    const body = (await req.json().catch(() => null)) ?? {}
    const email = body?.email?.toString().trim().toLowerCase()
    const password = body?.password?.toString()

    if (!email || !password) {
      console.log("[login] Missing email or password");
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 400 },
      )
    }
    if (!isEmail(email)) {
      console.log("[login] Invalid email format");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 })
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseClientKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseClientKey) {
      console.log("[login] Missing Supabase env variables");
      return NextResponse.json(
        { error: "Login is temporarily unavailable. Please contact admin." },
        { status: 503 },
      )
    }

    // Use anon client for password auth (doesn't require service role key on Vercel).
    const authClient = createClient(supabaseUrl, supabaseClientKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: authData, error: authError } =
      await authClient.auth.signInWithPassword({ email, password })

    if (authError || !authData.user) {
      console.log("[login] Supabase auth error:", authError?.message || "No user returned");
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      )
    }

    const accessToken = authData.session?.access_token
    if (!accessToken) {
      console.log("[login] Missing access token after login");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 })
    }

    const userClient = createClient(supabaseUrl, supabaseClientKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("*, organizations(id, name, logo_url, primary_color, plan)")
      .eq("id", authData.user.id)
      .single()

    if (profileError || !profile) {
      console.error("[login] profile query error:", profileError?.message || "No profile returned");
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      )
    }

    if (profile.status === "pending") {
      console.log("[login] Profile status is pending");
      return NextResponse.json(
        {
          error: "Invalid email or password.",
        },
        { status: 401 },
      )
    }

    if (profile.status === "inactive") {
      console.log("[login] Profile status is inactive");
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
      { error: "Login failed. Please check credentials and try again." },
      { status: 401 },
    )
  }
}
