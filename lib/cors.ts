import { NextRequest, NextResponse } from "next/server"

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "https://localhost:3000",
])

export function enforceCors(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin")
  if (!origin) return null

  const isVercel = origin.endsWith(".vercel.app")
  const isAppUrl = process.env.NEXT_PUBLIC_APP_URL && origin === process.env.NEXT_PUBLIC_APP_URL
  const isLocal = ALLOWED_ORIGINS.has(origin)

  if (!isVercel && !isAppUrl && !isLocal) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 403 })
  }
  return null
}
