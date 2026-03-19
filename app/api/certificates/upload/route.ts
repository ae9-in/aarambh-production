import { NextResponse, type NextRequest } from "next/server"
import { Buffer } from "buffer"
import { supabaseAdmin } from "@/lib/supabase"
import { requireAdmin, requireOrgMatch } from "@/lib/api-auth"
import { getAccessibleCategoryIdsForUser } from "@/lib/category-access"
import { detectType, uploadToCloudinary } from "@/lib/cloudinary"

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req)

    const form = await req.formData()
    const file = form.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing certificate file" }, { status: 400 })
    }

    const userId = String(form.get("userId") || "").trim()
    const contentId = String(form.get("contentId") || "").trim()
    const quizIdRaw = String(form.get("quizId") || "").trim()
    const scoreRaw = form.get("score")
    const courseName = String(form.get("courseName") || "").trim()
    const certificateNumber = String(form.get("certificateNumber") || "").trim()

    if (!userId || !contentId) {
      return NextResponse.json({ error: "Missing userId or contentId" }, { status: 400 })
    }

    const orgId = String(admin.orgId || "")
    if (!orgId) {
      return NextResponse.json({ error: "Missing admin orgId" }, { status: 400 })
    }

    await requireOrgMatch(userId, orgId)

    // 1) Validate approved category access for this candidate
    const { data: content } = await supabaseAdmin
      .from("content")
      .select("id,title,category_id,org_id,type")
      .eq("id", contentId)
      .maybeSingle()

    if (!content) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 })
    }

    const candidateRoleRow = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()

    const candidateRole = String(candidateRoleRow.data?.role || "EMPLOYEE")
    const accessibleIds = await getAccessibleCategoryIdsForUser(orgId, userId, candidateRole)
    const categoryId = content.category_id ? String(content.category_id) : null
    if (!categoryId || !accessibleIds.includes(categoryId)) {
      return NextResponse.json({ error: "Candidate is not approved for this course/category" }, { status: 403 })
    }

    // 2) Upload file to Cloudinary
    const mimeType = file.type || "application/octet-stream"
    const fileName = file.name || "certificate"
    const fileType = detectType(mimeType, fileName)
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const uploaded = await uploadToCloudinary(buffer, fileName, fileType)

    // 3) Upsert certificate row with new URL
    const quizId = quizIdRaw ? quizIdRaw : null
    const score = scoreRaw ? Number(String(scoreRaw)) : null

    const existing = await supabaseAdmin
      .from("certificates")
      .select("id,certificate_number,score,course_name")
      .eq("user_id", userId)
      .eq("content_id", contentId)
      .maybeSingle()

    if (existing.data?.id) {
      const { error: updateErr } = await supabaseAdmin
        .from("certificates")
        .update({
          certificate_url: uploaded.secureUrl,
          certificate_public_id: uploaded.publicId,
          score: score ?? undefined,
          course_name: courseName || undefined,
        })
        .eq("id", existing.data.id)

      if (updateErr) {
        return NextResponse.json({ error: "Failed to update certificate" }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    const newCertNumber =
      certificateNumber || `ARAMBH-${Date.now().toString(36).toUpperCase()}`

    const { error: insertErr } = await supabaseAdmin.from("certificates").insert({
      user_id: userId,
      org_id: orgId,
      content_id: contentId,
      quiz_id: quizId,
      course_name: courseName || String(content.title || "Course"),
      score: Number.isFinite(score as any) ? score : 0,
      certificate_number: newCertNumber,
      certificate_url: uploaded.secureUrl,
      certificate_public_id: uploaded.publicId,
    })

    if (insertErr) {
      return NextResponse.json({ error: "Failed to insert certificate" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("certificates upload error:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}

