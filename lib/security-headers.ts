export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://prod.spline.design https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://firebasestorage.googleapis.com https://res.cloudinary.com ws: wss:; img-src 'self' data: blob: https:; media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com https://res.cloudinary.com blob:; frame-src 'self' https://res.cloudinary.com https://view.officeapps.live.com https://docs.google.com; font-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

