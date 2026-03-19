import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const maxDuration = 300

const COMPANY_DOCS_BUCKET = process.env.SUPABASE_COMPANY_DOCS_BUCKET || "company-docs"

function isBucketNotFoundError(err: any): boolean {
  const statusCodeRaw = err?.statusCode ?? err?.status
  const statusCodeNum =
    typeof statusCodeRaw === "string" ? Number.parseInt(statusCodeRaw, 10) : statusCodeRaw
  const msg = String(err?.message || "").toLowerCase()
  return statusCodeNum === 404 || msg.includes("bucket not found")
}

async function ensureCompanyDocsBucketExists() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return false
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceKey

  // Create bucket via Supabase Storage REST API.
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: COMPANY_DOCS_BUCKET,
      public: true,
    }),
    })
  } catch (e: any) {
    console.error("Supabase bucket create request failed:", e)
    return false
  }

  // If bucket already exists, treat it as ok.
  if (res.ok) return true

  const text = await res.text().catch(() => "")
  const lower = text.toLowerCase()
  if (lower.includes("already exists") || lower.includes("duplicate")) return true
  console.error("Supabase bucket create failed:", {
    status: res.status,
    body: text.slice(0, 500),
    bucket: COMPANY_DOCS_BUCKET,
  })
  return false
}

function buildStoragePath(orgId: string, fileName: string): string {
  const ts = Date.now()
  const clean = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "-")
    .replace(/-+/g, "-")

  return `orgs/${orgId}/policy-docs/${ts}-${clean}`
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const orgId = formData.get("orgId") as string | null

    if (!file || !orgId) {
      return NextResponse.json({ error: "Missing file or orgId" }, { status: 400 })
    }

    const storagePath = buildStoragePath(orgId, file.name)
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from(COMPANY_DOCS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })

    if (uploadError) {
      console.error("Supabase company doc upload error:", uploadError)

      let finalError = uploadError
      if (isBucketNotFoundError(uploadError)) {
        // First-time setup: bucket may not exist yet.
        const created = await ensureCompanyDocsBucketExists()
        if (created) {
          const { error: retryError } = await supabaseAdmin.storage
            .from(COMPANY_DOCS_BUCKET)
            .upload(storagePath, buffer, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            })
          finalError = retryError ?? null
        } else {
          return NextResponse.json(
            {
              error: `Supabase Storage bucket '${COMPANY_DOCS_BUCKET}' not found (and auto-create failed). Create the bucket in Supabase Storage.`,
            },
            { status: 500 },
          )
        }
      }

      if (finalError) {
        return NextResponse.json(
          { error: finalError.message ?? "Failed to upload document" },
          { status: 500 },
        )
      }
    }

    let publicUrl = ""
    try {
      const res = supabaseAdmin.storage.from(COMPANY_DOCS_BUCKET).getPublicUrl(storagePath)
      publicUrl = res.data.publicUrl || ""
    } catch (e: any) {
      console.error("Company docs getPublicUrl error:", e)
    }

    return NextResponse.json({
      url: publicUrl,
      path: storagePath,
      size: file.size,
      bucket: COMPANY_DOCS_BUCKET,
    })
  } catch (e: any) {
    console.error("Company doc upload route error:", e)
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 })
  }
}
