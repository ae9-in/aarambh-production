"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Flame, Zap, Trophy, Calendar, Star } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { getNextLevel } from "@/lib/interactivity-helpers"
import { CountUp } from "@/components/count-up"

type WeeklyDay = { day: string; lessonsCompleted: number; minutesSpent: number }
type BadgeRow = { id: string; name: string; icon: string }

export default function ProgressPage() {
  const { user } = useAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [scoreProgress, setScoreProgress] = useState(0)
  const [xpProgress, setXpProgress] = useState(0)
  const [activeBar, setActiveBar] = useState<string | null>(null)

  const [weekly, setWeekly] = useState<WeeklyDay[]>([])
  const [streakDays, setStreakDays] = useState(0)
  const [xpPoints, setXpPoints] = useState(0)
  const [score, setScore] = useState(0)
  const [badges, setBadges] = useState<BadgeRow[]>([])

  const derived = useMemo(() => {
    const nextLevel = getNextLevel(xpPoints)
    const today = new Date()
    const streak = Math.max(0, Math.round(streakDays || 0))

    const days: Array<{ date: string; isToday: boolean; active: boolean }> = []
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days.push({
        date: key,
        isToday: i === 0,
        active: i < streak,
      })
    }

    return { nextLevel, streakDaysCalendar: days }
  }, [xpPoints, streakDays])

  const loadLiveData = useCallback(async () => {
    if (!user?.id || !user?.orgId) return
    setIsLoading(true)
    try {
      const userId = user.id
      const orgId = user.orgId

      const now = new Date()
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      const startStr = start.toISOString().slice(0, 10)

      const [weeklyRes, profileRes, userBadgesRes] = await Promise.all([
        supabase
          .from("weekly_activity")
          .select("date,lessons_completed,minutes_spent")
          .eq("user_id", userId)
          .eq("org_id", orgId)
          .gte("date", startStr)
          .order("date", { ascending: true })
          .limit(30),
        supabase
          .from("profiles")
          .select("xp_points,streak_days,score")
          .eq("id", userId)
          .maybeSingle(),
        supabase.from("user_badges").select("badge_id").eq("user_id", userId),
      ])

      const weeklyRows = (weeklyRes.data ?? []) as Array<any>
      const profileRow = profileRes.data as any
      const userBadgeRows = (userBadgesRes.data ?? []) as Array<any>

      const badgeIds = userBadgeRows.map((r) => String(r.badge_id)).filter(Boolean)
      let badgeRows: Array<any> = []
      if (badgeIds.length > 0) {
        const res = await supabase
          .from("badges")
          .select("id,name,icon")
          .in("id", badgeIds)
          .limit(8)
        badgeRows = (res.data ?? []) as Array<any>
      }

      // Build last 7 days buckets even if DB has gaps.
      const byDate = new Map<string, { lessonsCompleted: number; minutesSpent: number }>()
      for (const row of weeklyRows) {
        const dateStr = String(row.date)
        byDate.set(dateStr, {
          lessonsCompleted: Number(row.lessons_completed ?? 0),
          minutesSpent: Number(row.minutes_spent ?? 0),
        })
      }

      const buckets: WeeklyDay[] = []
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(now)
        d.setDate(now.getDate() - i)
        const dateStr = d.toISOString().slice(0, 10)
        const label = d.toLocaleDateString("en-US", { weekday: "short" })
        const row = byDate.get(dateStr)
        buckets.push({
          day: label,
          lessonsCompleted: row?.lessonsCompleted ?? 0,
          minutesSpent: row?.minutesSpent ?? 0,
        })
      }

      const nextScore = Number(profileRow?.score ?? user.score ?? 0)
      const nextXpPoints = Number(profileRow?.xp_points ?? user.xpPoints ?? 0)
      const nextStreakDays = Number(profileRow?.streak_days ?? user.streakDays ?? 0)

      setScore(nextScore)
      setXpPoints(nextXpPoints)
      setStreakDays(nextStreakDays)
      setWeekly(buckets)
      setBadges(
        (badgeRows ?? []).map((b) => ({
          id: String(b.id),
          name: String(b.name ?? "Badge"),
          icon: String(b.icon ?? "🏆"),
        })),
      )
    } catch (e) {
      console.error("progress live load error:", e)
    } finally {
      setIsLoading(false)
    }
  }, [user?.id, user?.orgId, user?.score, user?.xpPoints, user?.streakDays])

  useEffect(() => {
    if (!user?.id) return
    void loadLiveData()
  }, [loadLiveData, user?.id])

  useEffect(() => {
    if (!user?.id || !user?.orgId) return

    const channel = supabase
      .channel(`learn-progress-${user.orgId}-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weekly_activity", filter: `user_id=eq.${user.id}` },
        () => void loadLiveData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        () => void loadLiveData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_badges", filter: `user_id=eq.${user.id}` },
        () => void loadLiveData(),
      )
      .subscribe()

    const intervalId = window.setInterval(() => {
      void loadLiveData()
    }, 20000)

    return () => {
      window.clearInterval(intervalId)
      void supabase.removeChannel(channel)
    }
  }, [loadLiveData, user?.id, user?.orgId])

  useEffect(() => {
    const targetScore = Math.min(100, Math.round(score * 20))
    const targetXp = Math.min(100, (xpPoints / Math.max(derived.nextLevel.required, 1)) * 100)
    const timer = setTimeout(() => {
      setScoreProgress(targetScore)
      setXpProgress(targetXp)
    }, 200)
    return () => clearTimeout(timer)
  }, [derived.nextLevel.required, score, xpPoints])

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#78716C]">
        Loading progress...
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex items-center justify-center">
        Loading progress...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-20">
        <header className="mb-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#F97316]" />
            Progress & insights
          </h1>
          <p className="text-xs text-slate-400">Track your learning momentum over time.</p>
        </header>

        {/* Score gauge */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 mb-4"
        >
          <h2 className="text-sm font-medium text-slate-100 mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Performance score
          </h2>
          <div className="relative w-44 h-24 mx-auto">
            <svg viewBox="0 0 200 100" className="w-full h-full">
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="#1F2937"
                strokeWidth="16"
                strokeLinecap="round"
              />
              <motion.path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="#F97316"
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray="251.2"
                initial={{ strokeDashoffset: 251.2 }}
                animate={{ strokeDashoffset: 251.2 - (251.2 * scoreProgress) / 100 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
              <span className="text-3xl font-bold text-slate-50">
                <CountUp value={scoreProgress} />
              </span>
              <span className="text-sm text-slate-400">/100</span>
            </div>
          </div>
        </motion.div>

        {/* XP bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 mb-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-800">
                <Zap className="w-4 h-4 text-[#F97316]" />
              </span>
              <div>
                <p className="text-xs text-slate-400">XP to next level</p>
                <p className="text-sm font-semibold text-slate-100">{derived.nextLevel.name}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-[#F97316]">
                <CountUp value={xpPoints} />
              </p>
              <p className="text-xs text-slate-400">
                / {derived.nextLevel.required.toLocaleString()} XP
              </p>
            </div>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[#F97316] to-[#FB923C] rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${xpProgress}%` }}
              transition={{ duration: 1.1, delay: 0.2, ease: "easeOut" }}
            />
          </div>
        </motion.div>

        {/* Weekly activity */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              Weekly activity
            </h2>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-end justify-between gap-2 h-36">
              {weekly.map((day, index) => {
                const maxLessons = Math.max(...weekly.map((d) => d.lessonsCompleted || 1))
                const height = maxLessons ? (day.lessonsCompleted / maxLessons) * 100 : 0
                const isActive = activeBar === day.day
                return (
                  <motion.button
                    key={`${day.day}-${index}`}
                    type="button"
                    onClick={() => setActiveBar(day.day)}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: `${height}%`, opacity: 1 }}
                    transition={{ delay: 0.1 + index * 0.1 }}
                    className="flex-1 flex flex-col items-center justify-end gap-1 group relative"
                  >
                    <div
                      className={`w-6 rounded-full bg-gradient-to-t from-[#F97316] to-[#FDBA74] group-hover:from-[#FDBA74] ${
                        isActive ? "ring-2 ring-amber-400" : ""
                      }`}
                      style={{ minHeight: "12px" }}
                    />
                    <span className="text-[10px] text-slate-400">{day.day}</span>
                    {isActive && (
                      <div className="absolute -translate-y-20 px-2 py-1 rounded-md bg-slate-900 text-[10px] text-slate-100 shadow border border-slate-800">
                        <div>{day.lessonsCompleted} lessons</div>
                        <div className="text-slate-400">{day.minutesSpent} min</div>
                      </div>
                    )}
                  </motion.button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Streak calendar */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2">
              <Flame className="w-4 h-4 text-[#F97316]" />
              30-day streak
            </h2>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <div className="grid grid-cols-10 gap-2">
              {derived.streakDaysCalendar.map((d) => (
                <div key={d.date} className="flex items-center justify-center">
                  <div
                    className={[
                      "w-5 h-5 rounded-full border",
                      d.isToday ? "border-[#F97316] flex items-center justify-center" : "border-slate-700",
                      d.active ? "bg-[#F97316]" : "bg-slate-900",
                    ].join(" ")}
                  >
                    {d.isToday && !d.active && (
                      <div className="w-2 h-2 rounded-full bg-[#F97316]" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Badges */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-100 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400" />
              Badges
            </h2>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            {badges.length > 0 ? (
              <div className="grid grid-cols-4 gap-3">
                {badges.map((badge) => (
                  <div
                    key={badge.id}
                    className="relative flex flex-col items-center p-2 rounded-xl border border-slate-800"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center mb-1 bg-gradient-to-br from-[#F97316] to-[#FB923C]">
                      <span className="text-base">{badge.icon}</span>
                    </div>
                    <span className="text-[9px] text-center leading-tight text-slate-100">
                      {badge.name}
                    </span>
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Star className="w-2 h-2 text-white" />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">No badges yet — complete lessons and quizzes.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

