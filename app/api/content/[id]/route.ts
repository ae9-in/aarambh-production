import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'
import { sanitizeObject } from '@/lib/sanitize'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'
import { deleteFromCloudinary } from '@/lib/cloudinary'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

function isDeleteAdminRole(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req)
  const { id } = await params
  const effectiveUserId = auth.id

  const {
    data: content,
    error: contentError,
  } = await supabaseAdmin
    .from('content')
    .select('*, categories(name,icon)')
    .eq('id', id)
    .single()

  if (contentError || !content) {
    console.error('content fetch error:', contentError)
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }

  // Enforce category-level access for employee users.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', effectiveUserId)
    .maybeSingle()

  if ((content as any).org_id && (content as any).category_id && profile?.role) {
    await requireOrgMatch(auth.id, String((content as any).org_id))
    const allowedCategoryIds = await getAccessibleCategoryIdsForUser(
      String((content as any).org_id),
      effectiveUserId,
      String(profile.role),
    )
    if (!allowedCategoryIds.includes(String((content as any).category_id))) {
      return NextResponse.json({ error: 'Access denied for this category' }, { status: 403 })
    }
  }

  const {
    data: userProgress,
    error: progressError,
  } = await supabaseAdmin
    .from('user_progress')
    .select('*')
    .eq('user_id', effectiveUserId)
    .eq('content_id', id)
    .maybeSingle()

  if (progressError) {
    console.error('user_progress fetch error:', progressError)
  }

  const currentViews = (content as any).view_count ?? 0
  const incrementPromise = supabaseAdmin
    .from('content')
    .update({ view_count: currentViews + 1 })
    .eq('id', id)

  const accessLogPromise = supabaseAdmin.from('access_logs').insert({
    action: 'VIEW',
    user_id: effectiveUserId,
    content_id: id,
  })

  // Load reference materials from same category (non-video content)
  let materials: any[] = []
  if ((content as any).org_id && (content as any).category_id) {
    const { data: materialRows, error: materialError } = await supabaseAdmin
      .from('content')
      .select('id, title, type, file_url')
      .eq('org_id', (content as any).org_id)
      .eq('category_id', (content as any).category_id)
      .neq('id', id)
      .eq('is_published', true)
      .in('type', ['PDF', 'NOTE', 'PPT', 'LINK', 'AUDIO'])
      .order('created_at', { ascending: false })

    if (!materialError) {
      materials = materialRows ?? []
    } else {
      console.error('materials fetch error:', materialError)
    }
  }

  // Load quiz (if attached) from quizzes table
  let quiz: any = null
  const { data: quizRows, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, questions, pass_percent, time_limit_seconds')
    .eq('content_id', id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!quizError) {
    quiz = (quizRows && quizRows.length > 0) ? quizRows[0] : null
  } else {
    // Keep page usable even if quizzes table isn't ready.
    console.error('quiz fetch error:', quizError)
  }

  // Fire-and-forget for side effects
  Promise.all([incrementPromise, accessLogPromise]).catch((e) => {
    console.error('view side effects error:', e)
  })

  const resolvedContent = {
    ...content,
    fallback_file_url: (content as any).file_url,
    file_url: (content as any).file_url,
    category_image: (content as any)?.categories?.icon ?? null,
  }
  const resolvedMaterials = await Promise.all(
    (materials ?? []).map(async (m: any) => ({
      ...m,
      file_url: m.file_url,
    })),
  )

  return NextResponse.json(
    {
      content: resolvedContent,
      progress: userProgress ?? null,
      materials: resolvedMaterials,
      quiz,
    },
    { status: 200 },
  )
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(req)
  const { id } = await params

  try {
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
      title,
      description,
      categoryId,
      isPublished,
      xpReward,
    }: {
      title?: string
      description?: string | null
      categoryId?: string
      isPublished?: boolean
      xpReward?: number | null
    } = body

    const updates: Record<string, unknown> = {}

    if (typeof title === 'string') updates.title = title
    if (description !== undefined) updates.description = description
    if (typeof categoryId === 'string') updates.category_id = categoryId
    if (typeof isPublished === 'boolean') updates.is_published = isPublished
    if (xpReward !== undefined) updates.xp_reward = xpReward

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }
    const { data: existing } = await supabaseAdmin.from("content").select("org_id").eq("id", id).maybeSingle()
    if (existing?.org_id) {
      await requireOrgMatch(auth.id, String(existing.org_id))
    }

    const { data, error } = await supabaseAdmin
      .from('content')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) {
      console.error('content update error:', error)
      return NextResponse.json({ error: 'Failed to update content' }, { status: 400 })
    }

    return NextResponse.json({ content: data }, { status: 200 })
  } catch (e) {
    console.error('content PATCH error:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(_req)
  if (!isDeleteAdminRole(auth.role)) {
    return NextResponse.json({ error: 'Only admins can delete files' }, { status: 403 })
  }
  const { id } = await params

  const {
    data: content,
    error: contentError,
  } = await supabaseAdmin
    .from('content')
    .select('id, cloudinary_public_id, cloudinary_resource_type, org_id')
    .eq('id', id)
    .single()

  if (contentError || !content) {
    console.error('content fetch before delete error:', contentError)
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }
  if ((content as any).org_id) {
    await requireOrgMatch(auth.id, String((content as any).org_id))
  }

  const publicId = (content as any).cloudinary_public_id as string | null
  const resourceType = ((content as any).cloudinary_resource_type as
    | 'image'
    | 'video'
    | 'raw'
    | null) ?? 'raw'

  if (publicId) {
    void deleteFromCloudinary(publicId, resourceType)
  }

  const { error: deleteError } = await supabaseAdmin.from('content').delete().eq('id', id)

  if (deleteError) {
    console.error('content delete error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete content' }, { status: 400 })
  }

  return NextResponse.json({ deleted: true }, { status: 200 })
}
