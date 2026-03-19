import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req as any)
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }
    if (auth.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (auth.orgId) await requireOrgMatch(auth.id, auth.orgId)

    const { data, error } = await supabaseAdmin
      .from('certificates')
      .select(
        `
        *,
        content:content_id ( title ),
        quiz:quiz_id ( title )
      `,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('certificates fetch error:', error)
      return NextResponse.json({ error: 'Failed to load certificates' }, { status: 500 })
    }

    const certificates =
      data?.map(row => ({
        id: row.id,
        courseName: row.course_name ?? row.content?.title ?? row.quiz?.title,
        score: row.score,
        certificateNumber: row.certificate_number,
        createdAt: row.created_at,
        contentId: row.content_id,
        quizId: row.quiz_id,
      })) ?? []

    return NextResponse.json({ certificates })
  } catch (e) {
    console.error('GET /api/certificates unexpected:', e)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

