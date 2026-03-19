import { NextResponse } from "next/server"

type Bucket = { count: number; resetAt: number }
const RATE_STORE = new Map<string, Bucket>()

export function getClientIp(headers: Headers): string {
  const xfwd = headers.get("x-forwarded-for")
  if (xfwd) return xfwd.split(",")[0].trim()
  return headers.get("x-real-ip") || "unknown"
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  return (key: string) => {
    const now = Date.now()
    const row = RATE_STORE.get(key)
    if (!row || row.resetAt <= now) {
      RATE_STORE.set(key, { count: 1, resetAt: now + windowMs })
      return null
    }
    if (row.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.resetAt - now) / 1000))
      const res = NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
      res.headers.set("Retry-After", String(retryAfterSeconds))
      return res
    }
    row.count += 1
    RATE_STORE.set(key, row)
    return null
  }
}

export const enquiriesWriteLimiter = createRateLimiter(3, 60 * 60 * 1000)
export const loginLimiter = createRateLimiter(5, 15 * 60 * 1000)
export const registerLimiter = createRateLimiter(3, 60 * 60 * 1000)
export const generalApiLimiter = createRateLimiter(60, 60 * 1000)
export const aiChatLimiter = createRateLimiter(15, 60 * 60 * 1000)

