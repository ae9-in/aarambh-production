/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: ".",
  },
  experimental: {
    proxyClientMaxBodySize: 600 * 1024 * 1024,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://prod.spline.design https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://firebasestorage.googleapis.com https://res.cloudinary.com ws: wss:; img-src 'self' data: blob: https:; media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com https://res.cloudinary.com blob:; frame-src 'self' https://res.cloudinary.com https://view.officeapps.live.com https://docs.google.com; font-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Access-Control-Allow-Origin", value: process.env.NEXT_PUBLIC_APP_URL || "*" },
        ],
      },
    ]
  },
}

export default nextConfig
