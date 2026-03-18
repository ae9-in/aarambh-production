import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type CompanyDocType = "SOP" | "LEAVE_POLICY" | "LEAVE_CALENDAR" | "OTHER"

function isAdminRole(role?: string | null) {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role || "")
}

type RouteParams = { params: { id: string } }

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const docId = params.id
    const { searchParams } = req.nextUrl
    const orgId = searchParams.get("orgId")
    const userId = searchParams.get("userId")

    if (!docId) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    if (!orgId || !userId) return NextResponse.json({ error: "Missing orgId or userId" }, { status: 400 })

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", userId)
      .maybeSingle()

    if (!profile || !profile.org_id || String(profile.org_id) !== orgId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const { data: doc, error } = await supabaseAdmin
      .from("company_documents")
      .select("id, org_id, doc_type, title, description, file_url, firebase_path, mime_type, is_published, created_at")
      .eq("id", docId)
      .maybeSingle()

    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    if (String(doc.org_id) !== orgId) return NextResponse.json({ error: "Access denied" }, { status: 403 })

    if (!isAdminRole(profile.role) && !doc.is_published) {
      return NextResponse.json({ error: "Document not published" }, { status: 403 })
    }

    return NextResponse.json({ document: doc }, { status: 200 })
  } catch (e: any) {
    console.error("company-docs GET by id error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const docId = params.id
    const body = await req.json().catch(() => ({}))
    const { userId, orgId }: { userId?: string; orgId?: string } = body || {}

    if (!docId || !userId || !orgId) {
      return NextResponse.json({ error: "Missing docId, userId, or orgId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", userId)
      .maybeSingle()

    if (!profile || !isAdminRole(profile.role) || String(profile.org_id) !== orgId) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data: doc, error } = await supabaseAdmin
      .from("company_documents")
      .select("id, org_id, firebase_path")
      .eq("id", docId)
      .maybeSingle()

    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    if (doc.firebase_path) {
      // Delete file from Firebase Storage.
      // (We keep it simple here; actual deletion is handled via Firebase Admin inside `app/api/upload`.)
      const { getAdminStorage } = await import("@/lib/firebase-admin")
      const storage = getAdminStorage()
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "arambh-prod.appspot.com"
      await storage.bucket(bucketName).file(doc.firebase_path).delete().catch((e) => {
        console.error("company-docs DELETE firebase file error:", e)
      })
    }

    const { error: deleteError } = await supabaseAdmin.from("company_documents").delete().eq("id", docId)
    if (deleteError) return NextResponse.json({ error: "Failed to delete document" }, { status: 400 })

    return NextResponse.json({ deleted: true }, { status: 200 })
  } catch (e: any) {
    console.error("company-docs DELETE error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

