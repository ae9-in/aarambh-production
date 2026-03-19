import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  try {
    const cookie = req.cookies.get("arambh_user")?.value
    if (!cookie) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      )
    }

    let userId: string | null = null
    try {
      const parsed = JSON.parse(cookie)
      userId = parsed.id
    } catch {
      userId = cookie
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Invalid session." },
        { status: 401 },
      )
    }

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("*, organizations(id, name, logo_url, primary_color, plan)")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      console.error("[auth/me] profile query error:", error?.message)
      const res = NextResponse.json(
        { error: "Profile not found." },
        { status: 404 },
      )
      res.cookies.set("arambh_user", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      })
      return res
    }

    // Auto-heal users missing org_id (older registrations / approvals).
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

    return NextResponse.json({ profile })
  } catch (e) {
    console.error("auth/me error:", e)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    )
  }
}
