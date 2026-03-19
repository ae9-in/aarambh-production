"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import CountUp from "react-countup"
import { Search, Activity, CheckCircle2, Clock3, Trophy, RefreshCw, Users } from "lucide-react"

type EmployeeProgress = {
  id: string
  name: string
  email: string
  status: string
  department: string | null
  role: string
  completed: number
  inProgress: number
  pending: number
  totalAssigned: number
  progressPercent: number
  lastActivityAt: string | null
}

function timeAgo(value: string | null): string {
  if (!value) return "No activity yet"
  const now = Date.now()
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return "No activity yet"
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60000)
  if (min < 1) return "Just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export default function EmployeeProgressPage() {
  const [rows, setRows] = useState<EmployeeProgress[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending" | "inactive">("all")
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)

  const loadProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/users/progress", { credentials: "include" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to load employee progress.")
      }
      const data = await res.json()
      setRows(Array.isArray(data.employees) ? data.employees : [])
      setLastRefreshed(new Date().toISOString())
      setError(null)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || "Failed to load employee progress.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProgress()
    const id = setInterval(() => void loadProgress(), 10_000)
    return () => clearInterval(id)
  }, [loadProgress])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter((r) => {
      const matchesQuery =
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || r.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [rows, search, statusFilter])

  const totals = useMemo(() => {
    const totalEmployees = rows.length
    const completedAll = rows.filter((r) => r.totalAssigned > 0 && r.completed >= r.totalAssigned).length
    const withPending = rows.filter((r) => r.pending > 0).length
    const avg = rows.length > 0 ? Math.round(rows.reduce((sum, r) => sum + r.progressPercent, 0) / rows.length) : 0
    return { totalEmployees, completedAll, withPending, avg }
  }, [rows])

  const topPerformers = useMemo(() => {
    return [...rows].sort((a, b) => b.progressPercent - a.progressPercent).slice(0, 3)
  }, [rows])

  const lastRefreshText = useMemo(() => timeAgo(lastRefreshed), [lastRefreshed])

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-gradient-to-r from-[#1C1917] via-[#2A2724] to-[#1C1917] p-5 text-white md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#FDBA74]">Live Insights</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">Employee Progress</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#D6D3D1] md:text-base">
              Track completion, pending work, and live progress status of every registered employee.
            </p>
          </div>
          <button
            onClick={() => void loadProgress()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            <RefreshCw size={16} />
            Refresh Now
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-[#D6D3D1]">
          <Activity size={14} className="text-[#FF6B35]" />
          Auto-refresh every 10 seconds • Last updated {lastRefreshText}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 md:gap-4">
        {[
          { label: "Employees", value: totals.totalEmployees, icon: Users },
          { label: "Avg Completion", value: totals.avg, icon: CheckCircle2, suffix: "%" },
          { label: "Fully Completed", value: totals.completedAll, icon: CheckCircle2 },
          { label: "Need Attention", value: totals.withPending, icon: Clock3 },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-[#E7E5E4] bg-white p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-[#78716C] md:text-sm">{stat.label}</p>
              <stat.icon size={16} className="text-[#FF6B35]" />
            </div>
            <p className="text-2xl font-bold text-[#1C1917]">
              <CountUp end={stat.value} duration={0.8} />
              {stat.suffix || ""}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-[#E7E5E4] bg-white p-4 xl:col-span-2">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold text-[#1C1917]">Progress Tracker</h2>
            <div className="relative w-full md:w-[380px]">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#78716C]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, department..."
                className="w-full rounded-lg border border-[#E7E5E4] bg-white py-2.5 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#FF6B35]/20"
              />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {[
              { key: "all", label: "All" },
              { key: "active", label: "Active" },
              { key: "pending", label: "Pending" },
              { key: "inactive", label: "Inactive" },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setStatusFilter(item.key as any)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  statusFilter === item.key
                    ? "bg-[#FF6B35] text-white"
                    : "border border-[#E7E5E4] bg-white text-[#44403C] hover:border-[#FF6B35]/40"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="h-36 animate-pulse rounded-xl bg-[#E7E5E4]" />
          ) : (
            <div className="space-y-3 md:hidden">
              {filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D6D3D1] p-6 text-center text-sm text-[#78716C]">
                  No employees found.
                </div>
              ) : (
                filtered.map((row) => (
                  <div key={row.id} className="rounded-lg border border-[#E7E5E4] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#1C1917]">{row.name || "Unnamed"}</p>
                        <p className="truncate text-xs text-[#78716C]">{row.email}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                          row.status === "active"
                            ? "bg-green-100 text-green-700"
                            : row.status === "pending"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-[#FAF9F7] p-2">
                        <p className="text-[10px] text-[#78716C]">Completed</p>
                        <p className="text-sm font-semibold text-[#1C1917]">{row.completed}</p>
                      </div>
                      <div className="rounded-md bg-[#FAF9F7] p-2">
                        <p className="text-[10px] text-[#78716C]">In Progress</p>
                        <p className="text-sm font-semibold text-[#1C1917]">{row.inProgress}</p>
                      </div>
                      <div className="rounded-md bg-[#FAF9F7] p-2">
                        <p className="text-[10px] text-[#78716C]">Pending</p>
                        <p className="text-sm font-semibold text-[#1C1917]">{row.pending}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-[#1C1917]">{row.progressPercent}% complete</span>
                        <span className="text-[#78716C]">{row.completed}/{row.totalAssigned}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#F1EFEC]">
                        <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${row.progressPercent}%` }} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!isLoading && (
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[840px]">
                <thead className="border-b border-[#E7E5E4] bg-[#F9FAFB]">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">In Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Pending</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Completion %</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#78716C]">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-[#78716C]" colSpan={7}>
                        No employees found.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row) => (
                      <tr key={row.id} className="border-b border-[#E7E5E4] last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#1C1917]">{row.name || "Unnamed"}</p>
                            <p className="truncate text-xs text-[#78716C]">{row.email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              row.status === "active"
                                ? "bg-green-100 text-green-700"
                                : row.status === "pending"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-[#1C1917]">{row.completed}</td>
                        <td className="px-4 py-3 text-sm text-[#1C1917]">{row.inProgress}</td>
                        <td className="px-4 py-3 text-sm text-[#1C1917]">{row.pending}</td>
                        <td className="px-4 py-3">
                          <div className="w-36">
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="font-medium text-[#1C1917]">{row.progressPercent}%</span>
                              <span className="text-[#78716C]">{row.completed}/{row.totalAssigned}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-[#F1EFEC]">
                              <div
                                className="h-full rounded-full bg-[#FF6B35]"
                                style={{ width: `${Math.min(100, Math.max(0, row.progressPercent))}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#78716C]">{timeAgo(row.lastActivityAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[#E7E5E4] bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Trophy size={16} className="text-[#FF6B35]" />
              <h3 className="text-sm font-semibold text-[#1C1917]">Top Performers</h3>
            </div>
            {topPerformers.length === 0 ? (
              <p className="text-sm text-[#78716C]">No employee progress data yet.</p>
            ) : (
              <div className="space-y-3">
                {topPerformers.map((emp, idx) => (
                  <div key={emp.id} className="rounded-lg bg-[#FAF9F7] p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="truncate text-sm font-semibold text-[#1C1917]">
                        #{idx + 1} {emp.name || "Unnamed"}
                      </p>
                      <p className="text-sm font-bold text-[#FF6B35]">{emp.progressPercent}%</p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#ECE8E3]">
                      <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${emp.progressPercent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-[#78716C]">
                      {emp.completed}/{emp.totalAssigned} completed
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#E7E5E4] bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#1C1917]">Status Distribution</h3>
            <div className="space-y-2">
              {[
                { label: "Active", value: rows.filter((r) => r.status === "active").length, color: "bg-green-500" },
                { label: "Pending", value: rows.filter((r) => r.status === "pending").length, color: "bg-yellow-500" },
                { label: "Inactive", value: rows.filter((r) => r.status === "inactive").length, color: "bg-red-500" },
              ].map((item) => {
                const pct = rows.length > 0 ? Math.round((item.value / rows.length) * 100) : 0
                return (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-[#57534E]">
                      <span>{item.label}</span>
                      <span>{item.value} ({pct}%)</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#F1EFEC]">
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  )
}

