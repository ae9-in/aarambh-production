import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type TopPerformer = {
  user_id: string
  name: string
  avg_score: number
  pass_rate: number
  attempts: number
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const orgId = searchParams.get("orgId")
    const categoryIdsParam = searchParams.get("categoryIds")

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    }

    const categoryIds = categoryIdsParam
      ? categoryIdsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null

    // 1) Fetch lessons in the requested categories (or all for org)
    const { data: contentRows, error: contentError } = await supabaseAdmin
      .from("content")
      .select("id, category_id")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .limit(5000)

    if (contentError) {
      console.error("top-performers: content error", contentError)
    }

    const scopedContentRows =
      categoryIds && categoryIds.length > 0
        ? (contentRows || []).filter((r: any) => r.category_id && categoryIds.includes(r.category_id))
        : contentRows || []

    const contentIds = [...new Set(scopedContentRows.map((r: any) => r.id).filter(Boolean))]
    if (contentIds.length === 0) {
      return NextResponse.json({ topPerCategory: [] })
    }

    // 2) Fetch quizzes for those content items
    const { data: quizzes, error: quizError } = await supabaseAdmin
      .from("quizzes")
      .select("id, content_id")
      .in("content_id", contentIds)

    if (quizError) {
      console.error("top-performers: quizzes error", quizError)
    }

    const quizIds = [...new Set((quizzes || []).map((q: any) => q.id).filter(Boolean))]
    if (quizIds.length === 0) {
      return NextResponse.json({ topPerCategory: [] })
    }

    // 3) Fetch attempts for those quizzes
    const { data: attemptsRows, error: attemptsError } = await supabaseAdmin
      .from("quiz_attempts")
      .select("quiz_id, user_id, score, passed")
      .in("quiz_id", quizIds)
      .limit(20000)

    if (attemptsError) {
      console.error("top-performers: attempts error", attemptsError)
    }

    // Map quiz -> category via content_id (quizzes -> content -> category)
    const contentById = new Map(scopedContentRows.map((r: any) => [r.id, r]))
    const quizToCategoryId = new Map<string, string | null>()
    for (const q of quizzes || []) {
      const contentRow = contentById.get(q.content_id)
      quizToCategoryId.set(q.id, contentRow?.category_id ?? null)
    }

    const statsByCategoryUser = new Map<
      string,
      Map<
        string,
        {
          scoreSum: number
          passCount: number
          attempts: number
        }
      >
    >()

    for (const a of attemptsRows || []) {
      const quizId = a.quiz_id
      const categoryId = quizToCategoryId.get(quizId)
      if (!categoryId) continue

      const userId = a.user_id
      if (!userId) continue

      const perUserByCat =
        statsByCategoryUser.get(categoryId) ?? new Map<string, { scoreSum: number; passCount: number; attempts: number }>()

      const prev = perUserByCat.get(userId) ?? { scoreSum: 0, passCount: 0, attempts: 0 }
      prev.scoreSum += typeof a.score === "number" ? a.score : Number(a.score ?? 0)
      prev.passCount += a.passed ? 1 : 0
      prev.attempts += 1

      perUserByCat.set(userId, prev)
      statsByCategoryUser.set(categoryId, perUserByCat)
    }

    const categoryIdsUsed = [...statsByCategoryUser.keys()]
    if (categoryIdsUsed.length === 0) {
      return NextResponse.json({ topPerCategory: [] })
    }

    // 4) Fetch profile names for users we encountered
    const userIds = [
      ...new Set(
        [...statsByCategoryUser.values()]
          .flatMap((m) => [...m.keys()])
          .filter(Boolean),
      ),
    ]

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", userIds)

    if (profilesError) {
      console.error("top-performers: profiles error", profilesError)
    }

    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]))

    // 5) Fetch category names
    const { data: categories, error: catError } = await supabaseAdmin
      .from("categories")
      .select("id, name")
      .in("id", categoryIdsUsed)

    if (catError) {
      console.error("top-performers: categories error", catError)
    }

    const categoryById = new Map((categories || []).map((c: any) => [c.id, c]))

    // 6) Build response
    const topPerCategory = categoryIdsUsed.map((categoryId) => {
      const perUserByCat = statsByCategoryUser.get(categoryId) ?? new Map()
      const performers: TopPerformer[] = [...perUserByCat.entries()].map(([user_id, s]) => {
        const avg = s.attempts > 0 ? s.scoreSum / s.attempts : 0
        const passRate = s.attempts > 0 ? s.passCount / s.attempts : 0
        const profile = profileById.get(user_id)
        return {
          user_id,
          name: profile?.name ?? "Unknown",
          avg_score: Number(avg.toFixed(2)),
          pass_rate: Number((passRate * 100).toFixed(1)),
          attempts: s.attempts,
        }
      })

      performers.sort((a, b) => b.avg_score - a.avg_score)
      return {
        category_id: categoryId,
        category_name: categoryById.get(categoryId)?.name ?? "Category",
        performers: performers.slice(0, 3),
      }
    })

    // Sort categories by best performer
    topPerCategory.sort((a, b) => (b.performers[0]?.avg_score ?? 0) - (a.performers[0]?.avg_score ?? 0))

    return NextResponse.json({ topPerCategory })
  } catch (e) {
    console.error("top-performers route error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

