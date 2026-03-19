type Entry = { count: number; resetAt: number }

const store = new Map<string, Entry>()

export type RateLimitOptions = {
  key: string
  limit: number
  windowMs: number
}

export function getIpFromRequestHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return headers.get("x-real-ip") || "unknown"
}

export function checkRateLimit(opts: RateLimitOptions): {
  success: boolean
  retryAfterSeconds: number
  remaining: number
} {
  const now = Date.now()
  const current = store.get(opts.key)
  if (!current || current.resetAt <= now) {
    store.set(opts.key, { count: 1, resetAt: now + opts.windowMs })
    return {
      success: true,
      retryAfterSeconds: Math.ceil(opts.windowMs / 1000),
      remaining: Math.max(0, opts.limit - 1),
    }
  }

  if (current.count >= opts.limit) {
    return {
      success: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      remaining: 0,
    }
  }

  current.count += 1
  store.set(opts.key, current)
  return {
    success: true,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    remaining: Math.max(0, opts.limit - current.count),
  }
}

