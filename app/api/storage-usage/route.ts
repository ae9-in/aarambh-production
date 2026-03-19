import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

function formatGbFromBytes(bytes: bigint): string {
  const gb = Number(bytes) / 1024 / 1024 / 1024
  return gb.toFixed(2)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get("orgId")

    if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 })

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("id, max_storage_gb")
      .eq("id", orgId)
      .maybeSingle()

    if (orgErr) {
      console.error("storage-usage org query error:", orgErr)
      return NextResponse.json({ error: "Failed to load storage plan" }, { status: 500 })
    }

    const maxStorageGb = Number(org?.max_storage_gb ?? 0)

    const { data: contentRows, error: contentErr } = await supabaseAdmin
      .from("content")
      .select("file_size")
      .eq("org_id", orgId)

    if (contentErr) {
      console.error("storage-usage content query error:", contentErr)
      return NextResponse.json({ error: "Failed to load storage usage" }, { status: 500 })
    }

    const usedBytes = (contentRows ?? []).reduce((acc: bigint, row: any) => {
      try {
        const v = row?.file_size == null ? 0n : BigInt(String(row.file_size))
        return acc + v
      } catch {
        return acc
      }
    }, 0n)

    const totalBytes = BigInt(Math.max(0, Math.floor(maxStorageGb))) * 1024n * 1024n * 1024n

    const percent =
      totalBytes > 0n ? Number((usedBytes * 100n) / totalBytes) : 0

    return NextResponse.json(
      {
        usedBytes: usedBytes.toString(),
        totalStorageGb: maxStorageGb,
        usedStorageGb: formatGbFromBytes(usedBytes),
        percent,
      },
      { status: 200 },
    )
  } catch (e: any) {
    console.error("storage-usage route error:", e)
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 })
  }
}

