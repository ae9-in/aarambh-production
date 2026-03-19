import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req as any)
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // Admin/managers can view candidate certificates within their org.
    if (auth.id !== userId) {
      const role = String(auth.role || "")
      const isAdmin = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role)
      if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      if (!auth.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      await requireOrgMatch(userId, auth.orgId)
    } else {
      if (auth.orgId) await requireOrgMatch(auth.id, auth.orgId)
    }

    const orgId = auth.orgId || null

    const candidateRoleRow = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
    const candidateRole = String(candidateRoleRow.data?.role || "EMPLOYEE")

    const accessibleCategoryIds = orgId
      ? await getAccessibleCategoryIdsForUser(orgId, userId, candidateRole)
      : []
    const accessibleSet = new Set(accessibleCategoryIds)

    const { data, error } = await supabaseAdmin
      .from('certificates')
      .select(
        `
        *,
        content:content_id ( title, category_id ),
        quiz:quiz_id ( title )
      `,
      )
      .eq('user_id', userId)
      .order('issued_at', { ascending: false })

    if (error) {
      console.error('certificates fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load certificates', details: error?.message || String(error) },
        { status: 500 },
      )
    }

    const certificates =
      data
        ?.filter((row: any) => {
          const catId = row?.content?.category_id
          if (!catId) return false
          return accessibleSet.has(String(catId))
        })
        .map((row: any) => ({
          id: row.id,
          courseName: row.course_name ?? row.content?.title ?? row.quiz?.title,
          score: row.score,
          certificateNumber: row.certificate_number,
          createdAt: row.issued_at ?? row.created_at,
          contentId: row.content_id,
          quizId: row.quiz_id,
          certificateUrl: row.certificate_url ?? null,
        })) ?? []

    return NextResponse.json({ certificates })
  } catch (e) {
    console.error('GET /api/certificates unexpected:', e)
    return NextResponse.json(
      { error: 'An error occurred. Please try again.', details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

