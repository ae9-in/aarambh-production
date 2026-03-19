import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

export async function requireAuth(_req: NextRequest): Promise<{ id: string; role?: string; orgId?: string | null }> {
  const raw = (await cookies()).get("arambh_user")?.value
  if (!raw) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const parsed = JSON.parse(raw)
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

export async function requireAdmin(req: NextRequest): Promise<{ id: string; role: string; orgId?: string | null }> {
  const user = await requireAuth(req)
  const role = String(user.role || "")
  if (!["ADMIN", "SUPER_ADMIN"].includes(role)) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return { ...user, role }
}

