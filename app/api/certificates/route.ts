import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireOrgMatch } from '@/lib/api-auth'
import { getAccessibleCategoryIdsForUser } from '@/lib/category-access'

export async function GET(req: Request) {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7342/ingest/8c5934f4-43f8-490c-8480-111447782867',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9f4e64'},body:JSON.stringify({sessionId:'9f4e64',runId:'initial-2',hypothesisId:'H6',location:'app/api/certificates/route.ts:8',message:'certificates route entered',data:{url:req.url,hasCookie:Boolean((req as any)?.headers?.get?.('cookie'))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const auth = await requireAuth(req as any)
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    // #region agent log
    fetch('http://127.0.0.1:7342/ingest/8c5934f4-43f8-490c-8480-111447782867',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9f4e64'},body:JSON.stringify({sessionId:'9f4e64',runId:'initial',hypothesisId:'H4',location:'app/api/certificates/route.ts:11',message:'certificates read requested',data:{requestingOwnData:auth.id===userId,role:String(auth.role||'')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7342/ingest/8c5934f4-43f8-490c-8480-111447782867',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9f4e64'},body:JSON.stringify({sessionId:'9f4e64',runId:'initial',hypothesisId:'H5',location:'app/api/certificates/route.ts:56',message:'certificates query failed',data:{message:error?.message||'unknown'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7342/ingest/8c5934f4-43f8-490c-8480-111447782867',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9f4e64'},body:JSON.stringify({sessionId:'9f4e64',runId:'initial-2',hypothesisId:'H7',location:'app/api/certificates/route.ts:89',message:'certificates route threw',data:{error:e instanceof Error?e.message:String(e)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    console.error('GET /api/certificates unexpected:', e)
    return NextResponse.json(
      { error: 'An error occurred. Please try again.', details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

