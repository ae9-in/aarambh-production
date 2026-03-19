import DOMPurify from "isomorphic-dompurify"
import isEmail from "validator/lib/isEmail"

function stripHtml(value: string): string {
  const cleaned = DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
  return cleaned.replace(/<[^>]+>/g, "").trim()
}

export function sanitizeInput(value: unknown): unknown {
  if (typeof value === "string") return stripHtml(value)
  return value
}

export function sanitizeObject<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeObject(item)) as T
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = sanitizeObject(v)
    }
    return out as T
  }
  return sanitizeInput(input) as T
}

export function validateEmail(value: string): boolean {
  return isEmail(value)
}

export function containsHtml(value: string): boolean {
  return /<[^>]*>|&lt;|&gt;/i.test(value)
}

