import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'
import { sanitizeObject } from '@/lib/sanitize'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  const { searchParams } = new URL(req.url)

  const orgId = searchParams.get('orgId')
  const userRole = searchParams.get('userRole')
  const enforceAccess = searchParams.get('enforceAccess') === 'true'
  const categoryId = searchParams.get('categoryId')
  const type = searchParams.get('type')
  const search = searchParams.get('search')

  if (!orgId) {
    return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })
  }
  await requireOrgMatch(auth.id, orgId)

  let query = supabaseAdmin
    .from('content')
    .select(
      `
      *,
      categories(name,icon),
      uploader:profiles!content_uploaded_by_fkey(name)
    `,
      { count: 'exact' },
    )
    .eq('org_id', orgId)
    .eq('is_published', true)

  if (categoryId) {
    query = query.eq('category_id', categoryId)
  }

  if (type) {
    query = query.eq('type', type)
  }

  if (search) {
    query = query.ilike('title', `%${search}%`)
  }

  const effectiveUserId = auth.id
  const effectiveUserRole = auth.role || userRole || 'EMPLOYEE'

  if (enforceAccess && effectiveUserId) {
    const accessibleCategoryIds = await getAccessibleCategoryIdsForUser(
      orgId,
      effectiveUserId,
      effectiveUserRole,
    )
    if (accessibleCategoryIds.length === 0) {
      return NextResponse.json({ content: [], count: 0 }, { status: 200 })
    }
    query = query.in('category_id', accessibleCategoryIds)
  }

  const { data, count, error } = await query.order('order_index', {
    ascending: true,
  }).order('created_at', { ascending: false })

  if (error) {
    console.error('content list error:', error)
    return NextResponse.json({ error: 'Failed to load content' }, { status: 500 })
  }

  const content = await Promise.all(
    (data ?? []).map(async (item: any) => ({
      ...item,
      category_name: item.categories?.name ?? null,
      category_image: item.categories?.icon ?? null,
      uploader_name: item.uploader?.name ?? null,
    })),
  )

  return NextResponse.json(
    {
      content,
      count: count ?? content.length,
    },
    { status: 200 },
  )
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 415 })
    }
    const contentLength = Number(req.headers.get("content-length") || "0")
    if (contentLength > 10240) {
      return NextResponse.json({ error: "An error occurred. Please try again." }, { status: 413 })
    }
    const body = sanitizeObject(await req.json())
    const {
      orgId,
      categoryId,
      title,
      type,
      description,
      xpReward,
      fileUrl,
    }: {
      orgId: string
      categoryId: string
      title: string
      type: string
      description?: string | null
      xpReward?: number | null
      fileUrl?: string | null
    } = body

    if (!orgId || !categoryId || !title || !type) {
      return NextResponse.json(
        { error: 'Missing orgId, categoryId, title, or type' },
        { status: 400 },
      )
    }
    await requireOrgMatch(auth.id, orgId)

    const { data, error } = await supabaseAdmin
      .from('content')
      .insert({
        org_id: orgId,
        category_id: categoryId,
        title,
        type,
        description: description ?? null,
        xp_reward: xpReward ?? null,
        file_url: fileUrl ?? null,
        is_published: true,
      })
      .select('*')
      .single()

    if (error || !data) {
      console.error('content create error:', error)
      return NextResponse.json({ error: 'Failed to create content' }, { status: 400 })
    }

    // Fire-and-forget embedding trigger for AI-searchable lesson types.
    const aiSearchableTypes = new Set(['PDF', 'NOTE', 'PPT', 'VIDEO'])
    if (aiSearchableTypes.has(type.toUpperCase())) {
      const origin = req.nextUrl.origin
      fetch(`${origin}/api/ai/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-embed-key': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        },
        body: JSON.stringify({
          contentId: data.id,
          fileUrl: fileUrl ?? null,
          orgId,
        }),
      }).catch((embedErr) => {
        console.error('content: embed trigger error', embedErr)
      })
    }

    return NextResponse.json({ content: data }, { status: 201 })
  } catch (e) {
    console.error('content POST error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

