
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const email = "admin@arambh.com"
    const password = "Admin@123"

    // 1. Check if user exists
    const { data: { users }, error: listError } = await admin.auth.admin.listUsers()
    
    if (listError) {
      return NextResponse.json({ error: "Failed to list users", detail: listError.message }, { status: 500 })
    }

    const user = users.find(u => u.email === email)
    let userId: string
    
    if (!user) {
      // 2. Create user if not exists
      const { data: newUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: "Super Admin", role: "SUPER_ADMIN" }
      })

      if (createError || !newUser.user) {
        return NextResponse.json({ error: "Failed to create user", detail: createError?.message }, { status: 500 })
      }
      userId = newUser.user.id
    } else {
      userId = user.id
      // 3. Update password if user exists
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: password
      })

      if (updateError) {
        return NextResponse.json({ error: "Failed to reset password", detail: updateError.message }, { status: 500 })
      }
    }

    // 4. Ensure profile exists and is active
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()

    if (!profile) {
      const { error: profileCreateError } = await admin
        .from("profiles")
        .insert({
          id: userId,
          email,
          name: "Super Admin",
          role: "SUPER_ADMIN",
          status: "active"
        })
      if (profileCreateError) {
        return NextResponse.json({ error: "Failed to create profile", detail: profileCreateError.message }, { status: 500 })
      }
    } else if (profile.status !== "active") {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ status: "active", role: "SUPER_ADMIN" })
        .eq("id", userId)
      if (profileUpdateError) {
        return NextResponse.json({ error: "Failed to activate profile", detail: profileUpdateError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: "Admin account (auth + profile) reset/created successfully!", 
      email, 
      password,
      userId 
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
