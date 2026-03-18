import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type CompanyDocType = "SOP" | "LEAVE_POLICY" | "LEAVE_CALENDAR" | "OTHER"

function isAdminRole(role?: string | null) {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role || "")
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const orgId = searchParams.get("orgId")
    const userId = searchParams.get("userId")
    const docType = (searchParams.get("docType") || searchParams.get("type")) as
      | CompanyDocType
      | null

    if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", userId)
      .maybeSingle()

    if (!profile || !profile.org_id || String(profile.org_id) !== orgId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const query = supabaseAdmin
      .from("company_documents")
      .select("id, org_id, doc_type, title, description, file_url, mime_type, is_published, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })

    // Employees should only see published docs
    if (!isAdminRole(profile.role)) {
      query.eq("is_published", true)
    }

    if (docType) {
      query.eq("doc_type", docType)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: "Failed to load documents" }, { status: 500 })

    return NextResponse.json({ documents: data ?? [] }, { status: 200 })
  } catch (e: any) {
    console.error("company-docs GET error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      orgId,
      docType,
      title,
      description,
      fileUrl,
      firebasePath,
      mimeType,
      userId,
    }: {
      orgId?: string
      docType?: CompanyDocType
      title?: string
      description?: string | null
      fileUrl?: string
      firebasePath?: string | null
      mimeType?: string | null
      userId?: string
    } = body

    if (!orgId || !docType || !title || !fileUrl || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", userId)
      .maybeSingle()

    if (!profile || !isAdminRole(profile.role) || String(profile.org_id) !== orgId) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from("company_documents")
      .insert({
        org_id: orgId,
        doc_type: docType,
        title,
        description: description ?? null,
        file_url: fileUrl,
        firebase_path: firebasePath ?? null,
        mime_type: mimeType ?? null,
        uploaded_by: userId,
        is_published: true,
      })
      .select("*")
      .single()

    if (error || !data) {
      console.error("company-docs POST insert error:", error)
      return NextResponse.json({ error: "Failed to save document" }, { status: 400 })
    }

    // Fire-and-forget: create AI embeddings for this document.
    const origin = req.nextUrl.origin
    fetch(`${origin}/api/ai/company-docs/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyDocId: data.id,
        orgId,
      }),
    }).catch((embedErr) => console.error("company-docs embed trigger error:", embedErr))

    return NextResponse.json({ document: data }, { status: 201 })
  } catch (e: any) {
    console.error("company-docs POST error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

