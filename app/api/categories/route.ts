import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'
import { sanitizeObject } from '@/lib/sanitize'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'

function isResponseLike(value: unknown): value is NextResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'status' in (value as any) &&
      'headers' in (value as any),
  )
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req).catch((e) => e)
    if (isResponseLike(auth)) return auth
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const userRole = searchParams.get('userRole')
    const enforceAccess = searchParams.get('enforceAccess') === 'true'

    if (!orgId) {
      return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })
    }
    const orgCheck = await requireOrgMatch(auth.id, orgId).catch((e) => e)
    if (isResponseLike(orgCheck)) return orgCheck

    const { data: categories, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('org_id', orgId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error('categories list error:', error)
      return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 })
    }

    let accessibleCategoryIds: string[] | null = null
    if (enforceAccess) {
      try {
        accessibleCategoryIds = await getAccessibleCategoryIdsForUser(
          orgId,
          auth.id,
          auth.role || userRole || 'EMPLOYEE',
        )
      } catch (e) {
        console.log('[Categories] Access control check failed:', e)
        accessibleCategoryIds = []
      }
    }

    // Get content counts per category
    const { data: contentRows } = await supabaseAdmin
      .from('content')
      .select('category_id')
      .eq('org_id', orgId)

    const lessonCountMap: Record<string, number> = {}
    contentRows?.forEach((r: { category_id: string | null }) => {
      if (r.category_id) {
        lessonCountMap[r.category_id] = (lessonCountMap[r.category_id] ?? 0) + 1
      }
    })

    const enriched = (categories ?? [])
      .filter((cat) => {
        if (accessibleCategoryIds) return accessibleCategoryIds.includes(cat.id)
        return true
      })
      .map((c: { id: string; [k: string]: unknown }) => ({
        ...c,
        lesson_count: lessonCountMap[c.id] ?? (c.lesson_count as number) ?? 0,
        completion_percent: 0,
      }))

    return NextResponse.json({ categories: enriched }, { status: 200 })
  } catch (e) {
    if (isResponseLike(e)) return e
    console.error('categories GET error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 415 })
    }
    const contentLength = Number(req.headers.get("content-length") || "0")
    if (contentLength > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 })
    }
    const body = sanitizeObject(await req.json())
    const {
      orgId,
      name,
      description,
      icon,
      color,
      createdBy,
    }: {
      orgId: string
      name: string
      description?: string | null
      icon?: string | null
      color?: string | null
      createdBy: string
    } = body

    if (!orgId || !name || !createdBy) {
      return NextResponse.json(
        { error: 'Missing orgId, name, or createdBy' },
        { status: 400 },
      )
    }
    await requireOrgMatch(auth.id, orgId)

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({
        org_id: orgId,
        name,
        description: description ?? null,
        icon: icon ?? null,
        color: color ?? null,
        created_by: createdBy,
      })
      .select('*')
      .single()

    if (error || !data) {
      console.error('category create error:', error)
      return NextResponse.json({ error: 'Failed to create category' }, { status: 400 })
    }

    return NextResponse.json({ category: data }, { status: 201 })
  } catch (e) {
    console.error('categories POST error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}
