import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"

function freshAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function toStatus(value: unknown): ProgressStatus {
  const upper = String(value ?? "").toUpperCase()
  if (upper === "COMPLETED") return "COMPLETED"
  if (upper === "IN_PROGRESS") return "IN_PROGRESS"
  return "NOT_STARTED"
}

export async function GET(req: NextRequest) {
  const admin = freshAdmin()
  try {
    const cookie = req.cookies.get("arambh_user")?.value
    if (!cookie) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
    }

    let callerRole: string | null = null
    let callerId: string | null = null
    let orgId: string | null = null
    try {
      const parsed = JSON.parse(cookie)
      callerRole = parsed.role ?? null
      callerId = parsed.id ?? null
      orgId = parsed.orgId ?? parsed.org_id ?? null
    } catch {
      // ignore
    }

    if (!callerRole || !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(callerRole)) {
      return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 })
    }

    const queryOrgId = req.nextUrl.searchParams.get("orgId")
    let effectiveOrgId = queryOrgId || orgId
    if (!effectiveOrgId && callerId) {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", callerId)
        .maybeSingle()
      effectiveOrgId = (callerProfile?.org_id as string) ?? null
    }
    if (!effectiveOrgId) {
      return NextResponse.json({ error: "Missing orgId." }, { status: 400 })
    }

    const [{ count: totalContent, error: contentCountErr }, { data: employees, error: usersErr }] =
      await Promise.all([
        admin.from("content").select("id", { count: "exact", head: true }).eq("org_id", effectiveOrgId),
        admin
          .from("profiles")
          .select("id,name,email,status,department,role,created_at")
          .eq("org_id", effectiveOrgId)
          .eq("role", "EMPLOYEE")
          .order("created_at", { ascending: false }),
      ])

    if (contentCountErr) {
      console.error("users/progress content count error:", contentCountErr)
      return NextResponse.json({ error: "Failed to load content count." }, { status: 500 })
    }

    if (usersErr) {
      console.error("users/progress users query error:", usersErr)
      return NextResponse.json({ error: "Failed to load employees." }, { status: 500 })
    }

    const userList = employees ?? []
    const userIds = userList.map((u) => String((u as any).id))

    if (userIds.length === 0) {
      return NextResponse.json({
        orgId: effectiveOrgId,
        totalContent: totalContent ?? 0,
        employees: [],
      })
    }

    const { data: progressRows, error: progressErr } = await admin
      .from("user_progress")
      .select("user_id,status,updated_at,content:content_id(org_id)")
      .in("user_id", userIds)

    if (progressErr) {
      console.error("users/progress progress query error:", progressErr)
      return NextResponse.json({ error: "Failed to load progress data." }, { status: 500 })
    }

    const total = Number(totalContent ?? 0)
    const byUser = new Map<
      string,
      {
        completed: number
        inProgress: number
        notStarted: number
        progressPercent: number
        lastActivityAt: string | null
      }
    >()

    for (const id of userIds) {
      byUser.set(id, {
        completed: 0,
        inProgress: 0,
        notStarted: total,
        progressPercent: 0,
        lastActivityAt: null,
      })
    }

    for (const row of progressRows ?? []) {
      const userId = String((row as any).user_id ?? "")
      if (!userId || !byUser.has(userId)) continue

      const contentOrgId = String((row as any).content?.org_id ?? "")
      if (contentOrgId && contentOrgId !== effectiveOrgId) continue

      const bucket = byUser.get(userId)!
      const status = toStatus((row as any).status)
      if (status === "COMPLETED") bucket.completed += 1
      else if (status === "IN_PROGRESS") bucket.inProgress += 1

      const updatedAt = (row as any).updated_at ? String((row as any).updated_at) : null
      if (updatedAt && (!bucket.lastActivityAt || updatedAt > bucket.lastActivityAt)) {
        bucket.lastActivityAt = updatedAt
      }
    }

    const enriched = userList.map((u: any) => {
      const id = String(u.id)
      const stat = byUser.get(id) ?? {
        completed: 0,
        inProgress: 0,
        notStarted: total,
        progressPercent: 0,
        lastActivityAt: null,
      }
      const done = Math.min(total, stat.completed + stat.inProgress)
      const notStarted = Math.max(0, total - done)
      const progressPercent = total > 0 ? Math.round((stat.completed / total) * 100) : 0
      return {
        id,
        name: u.name ?? "",
        email: u.email ?? "",
        status: u.status ?? "active",
        department: u.department ?? null,
        role: u.role ?? "EMPLOYEE",
        completed: stat.completed,
        inProgress: stat.inProgress,
        pending: notStarted,
        totalAssigned: total,
        progressPercent,
        lastActivityAt: stat.lastActivityAt,
      }
    })

    return NextResponse.json({
      orgId: effectiveOrgId,
      totalContent: total,
      employees: enriched,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error("users/progress route error:", e)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}

