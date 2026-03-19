import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeObject, validateEmail } from "@/lib/sanitize"
import { getClientIp, registerLimiter } from "@/lib/rate-limiter"

function toRoleKey(value?: string | null) {
  if (!value) return null
  return value.trim().toUpperCase().replace(/\s+/g, "_")
}

function emailDomain(email: string): string {
  const parts = String(email || "").toLowerCase().split("@")
  return parts.length === 2 ? parts[1] : ""
}

async function inferOrgIdFromEmailDomain(email: string): Promise<string | null> {
  const domain = emailDomain(email)
  if (!domain) return null

  const { data: orgProfiles, error } = await supabaseAdmin
    .from("profiles")
    .select("org_id,email,role,status")
    .not("org_id", "is", null)
    .eq("status", "active")
    .in("role", ["SUPER_ADMIN", "ADMIN", "MANAGER"])

  if (error || !orgProfiles || orgProfiles.length === 0) {
    return null
  }

  const matchedOrgIds = new Set<string>()
  for (const row of orgProfiles as any[]) {
    const rowDomain = emailDomain(String(row.email || ""))
    if (rowDomain && rowDomain === domain && row.org_id) {
      matchedOrgIds.add(String(row.org_id))
    }
  }

  // Use inferred org only when there is a single unambiguous match.
  if (matchedOrgIds.size === 1) {
    return Array.from(matchedOrgIds)[0]
  }
  return null
}

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
    const limited = registerLimiter(`register:${ip}`)
    if (limited) return limited

    const body = sanitizeObject((await req.json().catch(() => null)) ?? {})
    const name = body?.name?.toString().trim()
    const email = body?.email?.toString().trim().toLowerCase()
    const password = body?.password?.toString()
    const department = body?.department?.toString().trim() || null
    const phone = body?.phone?.toString().trim() || null

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required." },
        { status: 400 },
      )
    }
    if (!validateEmail(email)) {
      return NextResponse.json(
        { error: "Invalid email format." },
        { status: 400 },
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 },
      )
    }

    // Check if email already exists
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (existingProfile) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    // Try creating auth user — trigger may or may not work
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role: "EMPLOYEE" },
      })

    let userId: string | null = authData?.user?.id ?? null

    if (authError) {
      console.error("register: createUser with metadata failed:", authError.message)

      // Try without metadata (trigger might fail on metadata parsing)
      const { data: d2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (e2) {
        console.error("register: bare createUser also failed:", e2.message)

        // Last resort: try signUp with anon key
        const anonClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        )
        const { data: d3, error: e3 } = await anonClient.auth.signUp({
          email,
          password,
        })

        if (e3 || !d3?.user) {
          console.error("register: signUp also failed:", e3?.message)
          return NextResponse.json(
            { error: "Failed to create account. Please try again later." },
            { status: 500 },
          )
        }

        userId = d3.user.id
        // Confirm email
        await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true })
      } else {
        userId = d2?.user?.id ?? null
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Failed to create account." },
        { status: 500 },
      )
    }

    // Ensure profile exists (trigger may have created it or not)
    const inferredOrgId = await inferOrgIdFromEmailDomain(email)
    const { data: existingNewProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()

    if (!existingNewProfile) {
      // Trigger didn't create it — insert manually
      const { error: insertErr } = await supabaseAdmin.from("profiles").insert({
        id: userId,
        email,
        name,
        role: "EMPLOYEE",
        status: "pending",
        department,
        phone,
        org_id: inferredOrgId,
      })
      if (insertErr) {
        // Retry without optional columns if schema is behind.
        const fallbackPayload: Record<string, unknown> = {
          id: userId,
          email,
          name,
          role: "EMPLOYEE",
          status: "pending",
          org_id: inferredOrgId,
        }
        const { error: fallbackErr } = await supabaseAdmin.from("profiles").insert(fallbackPayload)
        if (fallbackErr) {
          console.error("register: failed to create profile row:", fallbackErr)
          return NextResponse.json(
            { error: "Account created, but profile setup failed. Please contact admin." },
            { status: 500 },
          )
        }
      }
    } else {
      // Trigger created it — update with our fields
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({
          status: "pending",
          department,
          phone,
          name,
          ...(inferredOrgId ? { org_id: inferredOrgId } : {}),
        })
        .eq("id", userId)
      if (updateErr) {
        // Retry with required fields only.
        const { error: fallbackUpdateErr } = await supabaseAdmin
          .from("profiles")
          .update({
            status: "pending",
            name,
            ...(inferredOrgId ? { org_id: inferredOrgId } : {}),
          })
          .eq("id", userId)
        if (fallbackUpdateErr) {
          console.error("register: failed to update profile row:", fallbackUpdateErr)
          return NextResponse.json(
            { error: "Account created, but profile update failed. Please contact admin." },
            { status: 500 },
          )
        }
      }
    }

    // Notify admins (best-effort)
    try {
      const { data: createdProfile } = await supabaseAdmin
        .from("profiles")
        .select("org_id")
        .eq("id", userId)
        .maybeSingle()
      const orgId = (createdProfile?.org_id as string | null) ?? inferredOrgId

      const { data: admins } = await supabaseAdmin
        .from("profiles")
        .select("id, org_id")
        .in("role", ["SUPER_ADMIN", "ADMIN", "MANAGER"])
        .eq("status", "active")
        .eq("org_id", orgId ?? "")
        .limit(5)

      const fallbackAdmins = (!admins || admins.length === 0)
        ? await supabaseAdmin
            .from("profiles")
            .select("id, org_id")
            .in("role", ["SUPER_ADMIN", "ADMIN", "MANAGER"])
            .eq("status", "active")
            .limit(5)
        : null
      const targetAdmins = admins && admins.length > 0 ? admins : (fallbackAdmins?.data || [])

      if (targetAdmins.length > 0) {
        await supabaseAdmin.from("notifications").insert(
          targetAdmins.map((a: any) => ({
            user_id: a.id,
            org_id: a.org_id,
            type: "system",
            title: `New Registration: ${name}`,
            message: `${email} has registered and is waiting for approval.`,
            action_url: "/dashboard/users/approval",
          })),
        )
      }
    } catch {
      // best-effort
    }

    // Auto-approve default category access based on role mapping.
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("org_id, role, department")
        .eq("id", userId)
        .maybeSingle()

      const orgId = profile?.org_id as string | null
      const roleKey = toRoleKey(profile?.role) || "EMPLOYEE"
      const departmentKey = toRoleKey(department || profile?.department)

      if (orgId) {
        const lookupKeys = Array.from(new Set([roleKey, departmentKey].filter(Boolean) as string[]))
        const { data: defaults } = await supabaseAdmin
          .from("role_category_defaults")
          .select("category_id")
          .eq("org_id", orgId)
          .in("role_key", lookupKeys.length > 0 ? lookupKeys : [roleKey])

        const categoryIds = Array.from(
          new Set((defaults || []).map((row: any) => String(row.category_id))),
        )

        for (const categoryId of categoryIds) {
          const { data: access } = await supabaseAdmin
            .from("category_access")
            .select("id, allowed_user_ids")
            .eq("org_id", orgId)
            .eq("category_id", categoryId)
            .maybeSingle()

          if (access) {
            const allowed = Array.isArray(access.allowed_user_ids) ? access.allowed_user_ids : []
            if (!allowed.includes(userId)) {
              await supabaseAdmin
                .from("category_access")
                .update({
                  allowed_user_ids: [...allowed, userId],
                  updated_at: new Date().toISOString(),
                })
                .eq("id", access.id)
            }
          } else {
            await supabaseAdmin.from("category_access").insert({
              org_id: orgId,
              category_id: categoryId,
              allowed_roles: [],
              allowed_user_ids: [userId],
              updated_at: new Date().toISOString(),
            })
          }
        }
      }
    } catch (e) {
      console.error("register: role default access mapping failed:", e)
    }

    return NextResponse.json({
      success: true,
      pending: true,
      message:
        "Registration successful! Your account is pending approval by an administrator.",
    })
  } catch (e) {
    console.error("register route error:", e)
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 },
    )
  }
}
