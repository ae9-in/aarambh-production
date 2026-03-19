import { NextRequest, NextResponse } from "next/server"

const ALLOWED_ORIGINS = new Set([
  "https://arambh-lemon.vercel.app",
  "http://localhost:3000",
  "https://localhost:3000",
])

export function enforceCors(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin")
  if (!origin) return null
  if (!ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 403 })
  }
  return null
}

