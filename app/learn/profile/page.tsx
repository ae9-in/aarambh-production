"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Edit3, Download, Settings, Check, Bookmark, ChevronRight, Calendar, Phone } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { toast } from "sonner"

const easeExpo = [0.16, 1, 0.3, 1]

type CourseCard = {
  contentId: string
  title: string
  completedDate?: string | null
  hasCertificate: boolean
  status?: "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED"
}

type SavedCard = {
  contentId: string
  title: string
  categoryName: string
}

const quickActions = [
  { icon: Edit3, label: "Edit Profile", href: "/learn/settings" },
  { icon: Download, label: "Certificates", href: "/learn/certificates" },
  { icon: Settings, label: "Settings", href: "/learn/settings" },
]

export default function ProfilePage() {
  const { user: authUser } = useAuth()
  const [activeTab, setActiveTab] = useState<"courses" | "saved">("courses")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [stats, setStats] = useState({ enrolled: 0, completed: 0, saved: 0 })
  const [completedCourses, setCompletedCourses] = useState<CourseCard[]>([])
  const [savedCourses, setSavedCourses] = useState<SavedCard[]>([])

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDomain, setEditDomain] = useState("")
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreviewUrl, setEditAvatarPreviewUrl] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const openEdit = () => {
    setEditName(String(authUser?.name ?? profile?.name ?? ""))
    setEditDomain(String(authUser?.department ?? profile?.department ?? ""))
    setEditAvatarFile(null)
    setEditAvatarPreviewUrl(null)
    setIsEditOpen(true)
  }

  const closeEdit = () => {
    setIsEditOpen(false)
    setEditSaving(false)
    if (editAvatarPreviewUrl) URL.revokeObjectURL(editAvatarPreviewUrl)
    setEditAvatarFile(null)
    setEditAvatarPreviewUrl(null)
  }

  const loadLiveData = async (opts?: { initial?: boolean }) => {
    if (!authUser?.id || !authUser?.orgId) return
    const initial = opts?.initial ?? false
    if (initial) setIsLoading(true)
    else setIsRefreshing(true)
    try {
      const credentials = "include" as const

      const [meRes, catsRes, progressRes, certsRes, contentRes] = await Promise.all([
        fetch("/api/auth/me", { credentials }),
        fetch(
          `/api/categories?orgId=${encodeURIComponent(authUser.orgId)}&userId=${encodeURIComponent(
            authUser.id,
          )}&userRole=${encodeURIComponent(authUser.role || "EMPLOYEE")}&enforceAccess=true`,
          { credentials },
        ),
        fetch(
          `/api/progress?userId=${encodeURIComponent(authUser.id)}&orgId=${encodeURIComponent(
            authUser.orgId,
          )}`,
          { credentials },
        ),
        fetch(`/api/certificates?userId=${encodeURIComponent(authUser.id)}`, { credentials }),
        fetch(
          `/api/content?orgId=${encodeURIComponent(authUser.orgId)}&userRole=${encodeURIComponent(
            authUser.role || "EMPLOYEE",
          )}&enforceAccess=true`,
          { credentials },
        ),
      ])

      if (!catsRes.ok) throw new Error("Failed to load categories access")
      if (!progressRes.ok) throw new Error("Failed to load progress")
      if (!meRes.ok) throw new Error("Failed to load profile")
      if (!contentRes.ok) throw new Error("Failed to load content")

      const meJson = await meRes.json().catch(() => null)
      const meProfile = meJson?.profile ?? meJson ?? null

      const catsJson = await catsRes.json().catch(() => null)
      const accessibleCats = (catsJson?.categories ?? []) as Array<{ id: string; name: string }>
      const categoryIdSet = new Set(accessibleCats.map((c) => String(c.id)))
      const categoryNameById = new Map(accessibleCats.map((c) => [String(c.id), String(c.name || "")]))

      const progressJson = await progressRes.json().catch(() => null)
      const progress = (progressJson?.progress ?? []) as any[]

      const certsJson = await certsRes.json().catch(() => null)
      const certs = (certsJson?.certificates ?? []) as Array<{ contentId: string }>
      const certContentIdSet = new Set(certs.map((c) => String(c.contentId)))

      const contentJson = await contentRes.json().catch(() => null)
      const content = (contentJson?.content ?? []) as Array<{
        id: string
        title: string
        category_id?: string | null
        category_name?: string | null
      }>

      const progressByContentId = new Map<string, any>()
      for (const p of progress) {
        const cid = String(p.content_id ?? "")
        if (!cid) continue
        // Only consider progress inside approved/enforced categories.
        if (p.category_id && !categoryIdSet.has(String(p.category_id))) continue
        progressByContentId.set(cid, p)
      }

      const contentCards: CourseCard[] = content
        .filter((c) => c.id)
        .slice(0, 8)
        .map((c) => {
          const p = progressByContentId.get(String(c.id)) as any | undefined
          const statusUpper = String(p?.status ?? "").toUpperCase()
          const status: CourseCard["status"] =
            statusUpper === "COMPLETED"
              ? "COMPLETED"
              : statusUpper === "IN_PROGRESS"
                ? "IN_PROGRESS"
                : "NOT_STARTED"

          return {
            contentId: String(c.id),
            title: String(c.title || "Untitled course"),
            completedDate: p?.completed_at ? new Date(p.completed_at).toLocaleDateString() : null,
            hasCertificate: certContentIdSet.has(String(c.id)),
            status,
          }
        })

      const savedAll: SavedCard[] = progress
        .filter((p) => Boolean(p.is_bookmarked))
        .filter((p) => categoryIdSet.has(String(p.category_id)))
        .map((p) => ({
          contentId: String(p.content_id),
          title: String(p.title || "Untitled course"),
          categoryName: categoryNameById.get(String(p.category_id)) ?? "—",
        }))
      const savedCards: SavedCard[] = savedAll.slice(0, 8)

      const completedCount = content.reduce((acc, c) => {
        const p = progressByContentId.get(String(c.id)) as any | undefined
        return acc + (String(p?.status ?? "").toUpperCase() === "COMPLETED" ? 1 : 0)
      }, 0)

      const savedCount = savedAll.length

      setProfile(meProfile)
      setStats({
        enrolled: accessibleCats.length,
        completed: completedCount,
        saved: savedCount,
      })
      setCompletedCourses(contentCards)
      setSavedCourses(savedCards)
    } catch (e: any) {
      console.error(e)
      if (initial) toast.error(e?.message || "Failed to load profile data")
    } finally {
      if (initial) setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadLiveData({ initial: true })
    const intervalId = window.setInterval(() => {
      void loadLiveData({ initial: false })
    }, 30000)
    return () => window.clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authUser?.orgId])

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <div className="h-56 bg-[#1C1917]" />
        <div className="bg-[#F0EDE8] rounded-3xl h-48 animate-pulse" />
        <div className="px-6 -mt-16 max-w-lg mx-auto">
          <div className="mt-6 space-y-4">
            <div className="h-6 w-40 bg-[#F0EDE8] rounded animate-pulse" />
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-[#F0EDE8] rounded-2xl animate-pulse" />)}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Hero Section - Dark */}
      <div className="relative h-56 bg-[#1C1917] overflow-visible">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")" }} />
        {/* Orange blob */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#FF6B35] rounded-full filter blur-[100px] opacity-20" />
        
        {/* Avatar & Info */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pt-4">
          <motion.div
            className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#E85520] flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white/20 ring-offset-4 ring-offset-[#1C1917] overflow-hidden flex-shrink-0"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ease: easeExpo }}
          >
            {profile?.avatar_url || authUser?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile?.avatar_url || authUser?.avatarUrl}
                alt="profile avatar"
                className="w-full h-full object-cover rounded-full block"
              />
            ) : (
              <span>{authUser?.name?.[0] ?? "A"}</span>
            )}
          </motion.div>
          <motion.h1
            className="mt-4 text-xl font-bold text-white"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, ease: easeExpo }}
          >
            {authUser?.name || profile?.name || "—"}
          </motion.h1>
          <motion.p
            className="text-sm text-white/60 mt-1"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, ease: easeExpo }}
          >
            {authUser?.role || profile?.role || "—"}
          </motion.p>
          <motion.p
            className="text-xs text-white/40 mt-0.5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, ease: easeExpo }}
          >
            {authUser?.department || profile?.department || "—"}
          </motion.p>
          <motion.p
            className="text-[10px] text-white/50 mt-1"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, ease: easeExpo }}
          >
            {authUser?.email ? `Email: ${authUser.email}` : " "}
          </motion.p>
          <motion.p
            className="text-[10px] text-white/50 mt-0.5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, ease: easeExpo }}
          >
            <span className="inline-flex items-center gap-1">
              <Phone size={12} /> {profile?.phone ? `Phone: ${profile.phone}` : "Phone: —"}
            </span>
          </motion.p>

          <div className="mt-4 flex items-center justify-center relative z-30">
            <motion.button
              type="button"
              onClick={openEdit}
              whileTap={{ scale: 0.98 }}
              className="relative inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white text-[#1C1917] border border-white/50 hover:bg-[#F0EDE8] transition-colors shadow-sm"
            >
              <Edit3 size={16} />
              <span className="text-sm font-semibold">Edit</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Stats Card - Overlapping */}
      <div className="px-4 -mt-2 max-w-lg mx-auto relative z-10">
        <motion.div
          className="bg-white rounded-3xl p-6 shadow-xl shadow-black/10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, ease: easeExpo }}
        >
          {/* Stats Row */}
          <div className="flex items-center justify-around">
            {[
              { value: stats.enrolled, label: "Courses" },
              { value: stats.completed, label: "Completed" },
              { value: stats.saved, label: "Saved" },
            ].map((stat, idx) => (
              <div key={stat.label} className="text-center flex-1 relative">
                <p className="text-2xl font-bold text-[#1C1917]">{stat.value}</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">{stat.label}</p>
                {idx < 2 && <div className="absolute right-0 top-1 bottom-1 w-px bg-[#F0EDE8]" />}
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-3 mt-5 pt-5 border-t border-[#F0EDE8]">
            {quickActions.map((action, idx) => (
              <Link key={action.label} href={action.href} className="flex-1">
                <motion.div
                  className="flex flex-col items-center gap-2 py-3 rounded-xl border border-[#F0EDE8] hover:border-[#FF6B35] transition-colors group"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + idx * 0.05, ease: easeExpo }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <action.icon size={18} className="text-[#6B7280] group-hover:text-[#FF6B35] transition-colors" />
                  <span className="text-[11px] text-[#6B7280] group-hover:text-[#1C1917] transition-colors">{action.label}</span>
                </motion.div>
              </Link>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="px-6 mt-8 max-w-lg mx-auto">
        <div className="flex gap-2 p-1 bg-[#F0EDE8] rounded-xl">
          {(["courses", "saved"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab ? "bg-white text-[#1C1917] shadow-sm" : "text-[#9CA3AF]"
              }`}
            >
              {tab === "courses" ? "Courses" : "Saved"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6 max-w-lg mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === "courses" ? (
            <motion.div
              key="courses"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ ease: easeExpo }}
              className="space-y-3"
            >
              {completedCourses.map((course, idx) => (
                <motion.div
                  key={course.contentId}
                  className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-[#F0EDE8]"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, ease: easeExpo }}
                  whileHover={{ y: -2, boxShadow: "0 8px 24px rgba(0,0,0,0.06)" }}
                >
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#FF6B35]/20 to-[#E85520]/10 flex items-center justify-center text-[#FF6B35] font-bold">
                    {String(course.title || "C").trim().slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#1C1917] truncate">{course.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          course.status === "COMPLETED"
                            ? "bg-green-100 text-green-700"
                            : course.status === "IN_PROGRESS"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-[#F0EDE8] text-[#6B7280]"
                        }`}
                      >
                        {course.status === "COMPLETED"
                          ? "Completed"
                          : course.status === "IN_PROGRESS"
                            ? "In progress"
                            : "Not started"}
                      </span>
                      <span className="text-xs text-[#9CA3AF] flex items-center gap-1">
                        <Calendar size={10} /> {course.completedDate ? course.completedDate : "—"}
                      </span>
                    </div>
                  </div>
                  {course.status === "COMPLETED" ? (
                    course.hasCertificate ? (
                      <Link
                        href="/learn/certificates"
                        className="text-xs text-[#FF6B35] font-medium hover:underline whitespace-nowrap"
                      >
                        Certificate →
                      </Link>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                        <Check size={14} className="text-green-600" />
                      </div>
                    )
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#F0EDE8] flex items-center justify-center">
                      <span className="text-[10px] text-[#9CA3AF]">{course.status === "IN_PROGRESS" ? "…" : "—"}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="saved"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ ease: easeExpo }}
              className="space-y-3"
            >
              {savedCourses.map((course, idx) => (
                <motion.div
                  key={course.contentId}
                  className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-[#F0EDE8] cursor-pointer"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, ease: easeExpo }}
                  whileHover={{ y: -2, boxShadow: "0 8px 24px rgba(0,0,0,0.06)" }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#1C1917]/10 to-[#FF6B35]/10 flex items-center justify-center text-[#1C1917] font-bold">
                    {String(course.title || "C").trim().slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#1C1917] truncate">{course.title}</h3>
                    <div className="flex items-center gap-2 text-xs text-[#9CA3AF] mt-0.5">
                      <span>{course.categoryName}</span>
                      <span>•</span>
                      <span>Saved</span>
                    </div>
                  </div>
                  <Bookmark size={18} className="text-[#FF6B35] fill-[#FF6B35]" />
                  <ChevronRight size={16} className="text-[#9CA3AF]" />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isEditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40"
          onClick={closeEdit}
        >
          <div
            className="w-full max-w-lg self-center bg-white rounded-3xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#F0EDE8]">
              <div className="flex items-center gap-2">
                <Edit3 size={18} className="text-[#FF6B35]" />
                <h2 className="text-sm font-bold text-[#1C1917]">Edit Profile</h2>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md p-2 hover:bg-[#F5F5F4] text-[#78716C]"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#E85520] flex items-center justify-center text-white font-bold overflow-hidden">
                  {editAvatarPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={editAvatarPreviewUrl}
                      alt="avatar preview"
                      className="w-full h-full object-cover rounded-full block"
                    />
                  ) : (
                    <span>{String(authUser?.name ?? "").trim().slice(0, 1).toUpperCase() || "A"}</span>
                  )}
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-[#78716C]">Profile photo</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setEditAvatarFile(f)
                      if (f) {
                        if (editAvatarPreviewUrl) URL.revokeObjectURL(editAvatarPreviewUrl)
                        const url = URL.createObjectURL(f)
                        setEditAvatarPreviewUrl(url)
                      } else {
                        setEditAvatarPreviewUrl(null)
                      }
                    }}
                    className="block w-full text-xs text-[#78716C] mt-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#78716C]">Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E7E5E4] rounded-xl outline-none focus:ring-2 focus:ring-[#FF6B35]/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#78716C]">Domain (Department)</label>
                <input
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E7E5E4] rounded-xl outline-none focus:ring-2 focus:ring-[#FF6B35]/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#78716C]">Email (read-only)</label>
                <input
                  value={authUser?.email ?? ""}
                  readOnly
                  className="w-full px-3 py-2 border border-[#E7E5E4] rounded-xl outline-none bg-[#FAF9F7] text-[#6B7280]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#78716C]">Phone (read-only)</label>
                <input
                  value={String(profile?.phone ?? "")}
                  readOnly
                  className="w-full px-3 py-2 border border-[#E7E5E4] rounded-xl outline-none bg-[#FAF9F7] text-[#6B7280]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="flex-1 h-11 rounded-xl border border-[#E7E5E4] text-[#1C1917] font-semibold hover:border-[#FF6B35]"
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!authUser?.id) return
                    setEditSaving(true)
                    try {
                      // 1) Upload avatar first (if user selected one)
                      if (editAvatarFile) {
                        const fd = new FormData()
                        fd.append("file", editAvatarFile)
                        fd.append("userId", authUser.id)
                        const uploadRes = await fetch("/api/upload/avatar", {
                          method: "POST",
                          body: fd,
                          credentials: "include",
                        })
                        if (!uploadRes.ok) {
                          const data = await uploadRes.json().catch(() => null)
                          throw new Error(data?.error || "Failed to upload avatar")
                        }
                      }

                      // 2) Update name + domain only (email/phone never sent)
                      const res = await fetch("/api/auth/profile", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({
                          name: editName,
                          department: editDomain,
                        }),
                      })
                      if (!res.ok) {
                        const data = await res.json().catch(() => null)
                        throw new Error(data?.error || "Failed to update profile")
                      }

                      toast.success("Profile updated")
                      closeEdit()
                      void loadLiveData({ initial: false })
                    } catch (e: any) {
                      toast.error(e?.message || "Profile update failed")
                    } finally {
                      setEditSaving(false)
                    }
                  }}
                  className="flex-1 h-11 rounded-xl bg-[#FF6B35] text-white font-semibold hover:opacity-95"
                  disabled={editSaving}
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
