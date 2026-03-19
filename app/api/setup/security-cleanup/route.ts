import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireAdmin } from "@/lib/api-auth"
import { sanitizeString } from "@/lib/sanitize"

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req)
    const { data: rows, error } = await supabaseAdmin
      .from("enquiries")
      .select("id,name,message")
      .or("name.like.%<%,message.like.%<%")

    if (error) {
      return NextResponse.json({ error: "Failed to load enquiries." }, { status: 500 })
    }

    let updated = 0
    for (const row of rows || []) {
      const name = sanitizeString(String((row as any).name ?? ""))
      const message = sanitizeString(String((row as any).message ?? ""))
      const { error: updateError } = await supabaseAdmin
        .from("enquiries")
        .update({ name, message })
        .eq("id", (row as any).id)
      if (!updateError) updated += 1
    }

    return NextResponse.json({ success: true, updated })
  } catch (e) {
    console.error("security cleanup error:", e)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}

