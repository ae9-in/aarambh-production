import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/api-auth"

function getDomain(email: string): string {
  const parts = String(email || "").toLowerCase().split("@")
  return parts.length === 2 ? parts[1] : ""
}

async function inferOrgIdByEmailDomain(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  const domain = getDomain(email)
  if (!domain) return null

  const { data: adminProfiles } = await admin
    .from("profiles")
    .select("org_id,email,role,status")
    .in("role", ["SUPER_ADMIN", "ADMIN", "MANAGER"])
    .eq("status", "active")
    .not("org_id", "is", null)

  const matches = new Set<string>()
  for (const row of adminProfiles || []) {
    const profileDomain = getDomain(String((row as any).email || ""))
    if (profileDomain === domain && (row as any).org_id) {
      matches.add(String((row as any).org_id))
    }
  }

  if (matches.size === 1) return Array.from(matches)[0]
  return null
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req)
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const body = (await req.json().catch(() => ({}))) as { email?: string; orgId?: string; status?: string; role?: string }
    const targetEmail = String(body.email || "").trim().toLowerCase()
    const forceOrgId = body.orgId ? String(body.orgId) : null
    const targetStatus = String(body.status || "pending")
    const targetRole = String(body.role || "EMPLOYEE").toUpperCase()

    // Get all auth users
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 100 })
    let users = authData?.users ?? []
    if (targetEmail) {
      users = users.filter((u) => String(u.email || "").toLowerCase() === targetEmail)
      if (users.length === 0) {
        return NextResponse.json({ error: `No auth user found for ${targetEmail}` }, { status: 404 })
      }
    }

    const roleMap: Record<string, string> = {
      "admin@arambh.com": "SUPER_ADMIN",
      "manager@arambh.com": "MANAGER",
      "hr@arambh.com": "ADMIN",
    }

    const nameMap: Record<string, string> = {
      "admin@arambh.com": "Super Admin",
      "manager@arambh.com": "Manager",
      "hr@arambh.com": "HR Admin",
    }

    const results: { email: string; status: string; error?: string }[] = []

    for (const user of users) {
      const email = user.email ?? ""
      const role = targetEmail ? targetRole : (roleMap[email] || "EMPLOYEE")
      const name = nameMap[email] || user.user_metadata?.name || email.split("@")[0]
      const status = targetEmail ? targetStatus : (role === "EMPLOYEE" ? "pending" : "active")
      const inferredOrgId = forceOrgId || (targetEmail ? await inferOrgIdByEmailDomain(admin, email) : null)

      const { error } = await admin.from("profiles").upsert({
        id: user.id,
        email,
        name,
        role,
        status,
        org_id: inferredOrgId,
      })

      if (error) {
        results.push({ email, status: "error", error: error.message })
      } else {
        results.push({ email, status: "profile_created" })
      }
    }

    return NextResponse.json({
      success: true,
      mode: targetEmail ? "single-user-repair" : "bulk-repair",
      input: { email: targetEmail || null, orgId: forceOrgId, status: targetStatus, role: targetRole },
      results,
      hint: targetEmail
        ? "User repaired. Refresh /dashboard/users/approval with Pending filter."
        : "Bulk profile repair completed.",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
