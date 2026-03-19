import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/auth-helpers-nextjs"
import { supabaseAdmin } from "@/lib/supabase"

export async function requireAuth(req: NextRequest): Promise<{ id: string; role?: string; orgId?: string | null }> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {
          // no-op in route helper
        },
      },
    },
  )
  const { data } = await supabase.auth.getSession()
  const sessionUser = data?.session?.user
  if (!sessionUser?.id) {
    const raw = req.cookies.get("arambh_user")?.value
    if (!raw) {
      throw NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    try {
      const parsed = JSON.parse(decodeURIComponent(raw))
      if (!parsed?.id) throw new Error("Invalid auth cookie")
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role,org_id")
        .eq("id", parsed.id)
        .maybeSingle()
      return {
        id: parsed.id,
        role: (profile?.role as string | undefined) ?? parsed.role,
        orgId: (profile?.org_id as string | null | undefined) ?? parsed.orgId ?? parsed.org_id ?? null,
      }
    } catch {
      throw NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role,org_id")
    .eq("id", sessionUser.id)
    .maybeSingle()
  return {
    id: sessionUser.id,
    role: (profile?.role as string | undefined) ?? undefined,
    orgId: (profile?.org_id as string | null | undefined) ?? null,
  }
}

export async function requireAdmin(req: NextRequest): Promise<{ id: string; role: string; orgId?: string | null }> {
  const user = await requireAuth(req)
  const role = String(user.role || "")
  if (!["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(role)) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return { ...user, role }
}

export async function requireOrgMatch(userId: string, orgId: string): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle()
  if (!profile?.org_id || String(profile.org_id) !== String(orgId)) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
}

