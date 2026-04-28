import { NextRequest, NextResponse } from 'next/server'
import { SECURITY_HEADERS } from '@/lib/security-headers'
import { checkRateLimit, getIpFromRequestHeaders } from '@/lib/rate-limit'
import { enforceCors } from '@/lib/cors'

const SUSPICIOUS_URL_PATTERN =
  /(<script|%3Cscript|union(\s+all)?\s+select|drop\s+table|or\s+1=1|--|\.\.\/)/i

function withSecurityHeaders(res: NextResponse): NextResponse {
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  return res
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith('/api/')
  const isUploadApi =
    pathname === '/api/upload' ||
    pathname.startsWith('/api/upload/') ||
    pathname === '/api/company-docs' ||
    pathname.startsWith('/api/company-docs/')
  const isCategoryApi = pathname === '/api/categories' || pathname.startsWith('/api/categories/')

  if (SUSPICIOUS_URL_PATTERN.test(request.nextUrl.href)) {
    console.warn('[security] blocked suspicious URL', request.nextUrl.href)
    return withSecurityHeaders(
      NextResponse.json({ error: 'Blocked suspicious request.' }, { status: 400 }),
    )
  }

  const contentLength = Number(request.headers.get('content-length') || '0')
  const maxContentLength = isUploadApi
    ? 600 * 1024 * 1024
    : isCategoryApi
      ? 25 * 1024 * 1024
      : 1 * 1024 * 1024
  if (contentLength > maxContentLength) {
    return withSecurityHeaders(
      NextResponse.json({ error: 'Payload too large.' }, { status: 413 }),
    )
  }

  if (isApi) {
    if (request.method === 'OPTIONS') return withSecurityHeaders(NextResponse.next())

    const corsRes = enforceCors(request)
    if (corsRes) return withSecurityHeaders(corsRes)

    const ip = getIpFromRequestHeaders(request.headers)
    const genericLimit = checkRateLimit({
      key: `api:${ip}`,
      limit: 100,
      windowMs: 60_000,
    })
    if (!genericLimit.success) {
      const res = NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
      res.headers.set('Retry-After', String(genericLimit.retryAfterSeconds))
      return withSecurityHeaders(res)
    }

    const isPublicApi =
      pathname === '/api/auth/login' ||
      pathname === '/api/auth/register' ||
      pathname.includes('/api/debug/') ||
      pathname.includes('/api/setup/') ||
      (pathname === '/api/enquiries' && request.method === 'POST')
    
    if (!isPublicApi) {
      const authCookie = request.cookies.get('arambh_user')
      if (!authCookie?.value) {
        return withSecurityHeaders(
          NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        )
      }
    }

    return withSecurityHeaders(NextResponse.next())
  }

  const cookie = request.cookies.get('arambh_user')

  const publicPaths = ['/login', '/register', '/forgot-password']
  const isHomePage = pathname === '/'
  const isPublicPath = publicPaths.some((p) => pathname === p)

  if (isHomePage) {
    return NextResponse.next()
  }

  if (isPublicPath) {
    if (cookie) {
      let redirectTo = '/dashboard'
      try {
        const parsed = JSON.parse(cookie.value)
        if (parsed.role === 'EMPLOYEE' || parsed.role === 'VIEWER') {
          redirectTo = '/learn'
        }
      } catch {
        // ignore
      }
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }
    return NextResponse.next()
  }

  if (!cookie) {
    return withSecurityHeaders(NextResponse.redirect(new URL('/login', request.url)))
  }

  return withSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public|demo-placeholder\\.html|demo-script\\.md|demo-video\\.mp4).*)',
  ],
}
