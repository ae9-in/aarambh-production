import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth(req)
    const { id } = await params

    const { data: content, error } = await supabaseAdmin
      .from('content')
      .select('id, org_id, category_id, title, type, file_url, is_published')
      .eq('id', id)
      .eq('is_published', true)
      .maybeSingle()

    if (error || !content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 })
    }

    await requireOrgMatch(auth.id, String(content.org_id))

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', auth.id)
      .maybeSingle()

    const allowedCategoryIds = await getAccessibleCategoryIdsForUser(
      String(content.org_id),
      auth.id,
      String(profile?.role || auth.role || 'EMPLOYEE'),
    )

    if (!allowedCategoryIds.includes(String(content.category_id))) {
      return NextResponse.json({ error: 'Access denied for this category' }, { status: 403 })
    }

    if (!content.file_url) {
      return NextResponse.json({ error: 'No file URL found' }, { status: 404 })
    }

    const upstream = await fetch(content.file_url)
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Failed to fetch source file' }, { status: 502 })
    }

    const fileBuffer = await upstream.arrayBuffer()
    const upperType = String(content.type || '').toUpperCase()
    const isPdf = upperType === 'PDF'
    const contentType =
      isPdf
        ? 'application/pdf'
        : upstream.headers.get('content-type') || 'application/octet-stream'

    const extMap: Record<string, string> = {
      PDF: 'pdf',
      PPT: 'pptx',
      NOTE: 'txt',
      AUDIO: 'mp3',
      VIDEO: 'mp4',
      IMAGE: 'jpg',
    }
    const ext = extMap[upperType] || 'bin'
    const rawTitle = String((content as any).title || 'document')
    const safeTitle = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document'
    const filename = `${safeTitle}.${ext}`
    const shouldDownload = req.nextUrl.searchParams.get('download') === '1'

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': shouldDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    console.error('content document route error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

