import isEmail from "validator/lib/isEmail"
import { z } from "zod"

const BLOCK_PATTERNS: RegExp[] = [
  /javascript:/gi,
  /data:/gi,
  /vbscript:/gi,
  /on[a-z]+\s*=/gi,
  /file:\/\//gi,
  /\.\.\//g,
  /\{\{.*?\}\}/g,
  /__proto__/gi,
  /constructor/gi,
  /169\.254\.169\.254/g,
  /<script/gi,
  /<svg/gi,
  /<img[^>]*onerror/gi,
  /<iframe/gi,
]

export function sanitizeString(value: string): string {
  // Keep this utility server-safe for Next.js API routes (no DOM dependencies).
  let out = String(value ?? "")
  out = out.replace(/<[^>]*>/g, "")
  for (const pattern of BLOCK_PATTERNS) {
    out = out.replace(pattern, "")
  }
  return out.trim()
}

export function sanitizeObject<T>(input: T): T {
  if (typeof input === "string") return sanitizeString(input) as T
  if (Array.isArray(input)) return input.map((v) => sanitizeObject(v)) as T
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = sanitizeObject(v)
    }
    return out as T
  }
  return input
}

export function validateEmail(value: string): boolean {
  return isEmail(value)
}

const enquirySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required.")
    .max(100, "Name is too long.")
    .regex(/^[A-Za-z\s\-']+$/, "Name contains invalid characters."),
  email: z.string().email("Invalid email format."),
  phone: z
    .string()
    .min(7, "Phone is too short.")
    .max(15, "Phone is too long.")
    .regex(/^[0-9+\-\s()]+$/, "Phone contains invalid characters."),
  company: z.string().max(200, "Company is too long.").optional().nullable(),
  message: z.string().max(1000, "Message is too long.").optional().nullable(),
})

export type ValidEnquiryInput = z.infer<typeof enquirySchema>

export function validateEnquiryInput(input: unknown): ValidEnquiryInput {
  const parsed = enquirySchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw {
      field: issue?.path?.join(".") || "unknown",
      reason: issue?.message || "Invalid input.",
    }
  }
  return parsed.data
}

