"use client"

import { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Award, Upload, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import CountUp from "react-countup"
import { toast } from "sonner"

const easeExpo = [0.16, 1, 0.3, 1]

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  status: "active" | "inactive" | "pending" | string
  department: string | null
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "pending">("all")
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [certSidebarUserId, setCertSidebarUserId] = useState<string | null>(null)
  const [candidateCertificates, setCandidateCertificates] = useState<
    Array<any>
  >([])
  const [certLoading, setCertLoading] = useState(false)
  const [uploadingCertId, setUploadingCertId] = useState<string | null>(null)

  const loadUsers = async () => {
    try {
      setIsLoading(true)
      const res = await fetch("/api/users", { credentials: "include" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to load users.")
      }
      const data = await res.json()
      const list: any[] = data.users ?? []
      setUsers(
        list.map((u) => ({
          id: u.id,
          name: u.name ?? "",
          email: u.email ?? "",
          role: u.role ?? "EMPLOYEE",
          status: (u.status ?? "active") as UserRow["status"],
          department: u.department ?? null,
        })),
      )
      setError(null)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || "Failed to load users.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const loadCandidateCertificates = async (userId: string) => {
    setCertLoading(true)
    try {
      const res = await fetch(`/api/certificates?userId=${encodeURIComponent(userId)}`, {
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to load certificates")
      }
      const data = await res.json()
      setCandidateCertificates((data?.certificates ?? []) as any[])
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Failed to load certificates")
      setCandidateCertificates([])
    } finally {
      setCertLoading(false)
    }
  }

  const handleOpenCertificateSidebar = (userId: string) => {
    setCertSidebarUserId(userId)
    void loadCandidateCertificates(userId)
  }

  const handleUploadCertificate = async (cert: any, file: File) => {
    if (!certSidebarUserId) return
    setUploadingCertId(String(cert?.id || ""))
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("userId", certSidebarUserId)
      form.append("contentId", String(cert?.contentId || ""))
      form.append("quizId", String(cert?.quizId || ""))
      form.append("courseName", String(cert?.courseName || ""))
      form.append("score", String(cert?.score ?? 0))
      form.append("certificateNumber", String(cert?.certificateNumber || ""))

      const res = await fetch("/api/certificates/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Certificate upload failed")
      }

      toast.success("Certificate uploaded")
      await loadCandidateCertificates(certSidebarUserId)
    } catch (e: any) {
      toast.error(e?.message || "Certificate upload failed")
    } finally {
      setUploadingCertId(null)
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus =
        statusFilter === "all" ||
        user.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [users, searchQuery, statusFilter])

  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter((u) => u.status === "active").length
    const inactive = users.filter((u) => u.status === "inactive").length
    const pending = users.filter((u) => u.status === "pending").length
    return { total, active, inactive, pending }
  }, [users])

  const updateUser = async (id: string, payload: { status?: string; role?: string }) => {
    try {
      setUpdatingId(id)
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update user.")
      }
      const body = await res.json().catch(() => null)
      const updated = body?.user ?? body
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                role: updated?.role ?? u.role,
                status: (updated?.status ?? u.status) as UserRow["status"],
              }
            : u,
        ),
      )
      toast.success("User updated.")
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Failed to update user.")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleStatusChange = (user: UserRow) => {
    const order: UserRow["status"][] = ["active", "inactive", "pending"]
    const idx = order.indexOf(user.status as any)
    const next = order[(idx + 1 + order.length) % order.length]
    void updateUser(user.id, { status: next })
  }

  if (isLoading) return <div className="space-y-6"><div className="h-8 bg-[#E7E5E4] rounded-lg w-1/3 animate-pulse" /></div>

  return (
    <div className="space-y-6">
      <motion.div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: easeExpo }}>
        <div><h1 className="text-3xl font-bold text-[#1C1917]">Users & Roles</h1><p className="text-[#78716C] mt-1">Manage real team members from Supabase</p></div>
      </motion.div>

      <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {[{ label: "Total Users", value: stats.total }, { label: "Active", value: stats.active }, { label: "Inactive", value: stats.inactive }, { label: "Pending", value: stats.pending }].map((stat, i) => (
          <motion.div key={stat.label} className="bg-white rounded-xl border border-[#E7E5E4] p-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }} whileHover={{ y: -2 }}>
            <p className="text-sm text-[#78716C]">{stat.label}</p>
            <p className="text-2xl font-bold text-[#1C1917] mt-1"><CountUp end={stat.value} duration={1} /></p>
          </motion.div>
        ))}
      </motion.div>

      <motion.div className="flex flex-col gap-3 sm:flex-row sm:gap-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="relative flex-1"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#78716C]" /><input type="text" placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-11 pr-4 py-3 border border-[#E7E5E4] rounded-lg focus:ring-2 focus:ring-[#FF6B35]/20 outline-none" /></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">{["all", "active", "inactive", "pending"].map((status) => (<motion.button key={status} onClick={() => setStatusFilter(status as any)} className={`px-4 py-2 rounded-lg font-medium transition-all ${statusFilter === status ? "bg-[#FF6B35] text-white" : "bg-white border border-[#E7E5E4]"}`} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>{status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}</motion.button>))}</div>
      </motion.div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="bg-white rounded-xl border border-[#E7E5E4] overflow-hidden">
        <div className="space-y-2 p-3 md:hidden">
          <AnimatePresence>
            {filteredUsers.map((user, idx) => (
              <motion.div
                key={`card-${user.id}`}
                className="rounded-lg border border-[#E7E5E4] bg-white p-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: idx * 0.04 }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF6B35] text-xs font-bold text-white">
                    {user.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1C1917]">{user.name}</p>
                    <p className="truncate text-xs text-[#78716C]">{user.email}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[11px] text-[#78716C]">Role</p>
                    <Select
                      value={user.role}
                      onValueChange={(role) => void updateUser(user.id, { role })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"].map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#78716C]">Status</p>
                    <motion.button
                      onClick={() => handleStatusChange(user)}
                      disabled={updatingId === user.id}
                      className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${
                        user.status === "active"
                          ? "bg-green-100 text-green-700"
                          : user.status === "inactive"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                      whileTap={{ scale: 0.98 }}
                    >
                      {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                    </motion.button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#78716C]">Department: {user.department || "—"}</p>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleOpenCertificateSidebar(user.id)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-[#E7E5E4] px-3 py-2 text-xs font-semibold hover:border-[#FF6B35] hover:text-[#FF6B35]"
                  >
                    <Award size={14} />
                    Certificates
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <table className="hidden w-full md:table">
          <thead className="bg-[#F9FAFB] border-b border-[#E7E5E4]">
            <tr><th className="text-left text-xs font-semibold text-[#78716C] px-6 py-4">Name</th><th className="text-left text-xs font-semibold text-[#78716C] px-6 py-4">Email</th><th className="text-left text-xs font-semibold text-[#78716C] px-6 py-4">Role</th><th className="text-left text-xs font-semibold text-[#78716C] px-6 py-4">Status</th><th className="text-right text-xs font-semibold text-[#78716C] px-6 py-4">Actions</th></tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filteredUsers.map((user, idx) => (
                <motion.tr key={user.id} className="border-b border-[#E7E5E4] hover:bg-[#F9FAFB] group" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} exit={{ opacity: 0, y: -10 }}>
                  <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-[#FF6B35] text-white flex items-center justify-center text-xs font-bold">{user.name.charAt(0)}</div><span className="font-medium text-[#1C1917]">{user.name}</span></div></td>
                  <td className="px-6 py-4 text-sm text-[#78716C]">{user.email}</td>
                  <td className="px-6 py-4">
                    <Select
                      value={user.role}
                      onValueChange={(role) =>
                        void updateUser(user.id, { role })
                      }
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"].map(
                          (r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-6 py-4">
                    <motion.button
                      onClick={() => handleStatusChange(user)}
                      disabled={updatingId === user.id}
                      className={`px-3 py-1 text-xs font-semibold rounded-full ${
                        user.status === "active"
                          ? "bg-green-100 text-green-700"
                          : user.status === "inactive"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                      whileHover={{ scale: 1.05 }}
                    >
                      {user.status.charAt(0).toUpperCase() +
                        user.status.slice(1)}
                    </motion.button>
                  </td>
                  <td className="px-6 py-4 text-right text-xs text-[#78716C]">
                    <div className="flex flex-col items-end gap-2">
                      <span>{user.department || "—"}</span>
                      <button
                        type="button"
                        onClick={() => handleOpenCertificateSidebar(user.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold hover:border-[#FF6B35] hover:text-[#FF6B35] transition-colors"
                      >
                        <Award size={14} />
                        Certs
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {certSidebarUserId && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
          onClick={() => setCertSidebarUserId(null)}
        >
          <div
            className="w-full max-w-lg bg-white h-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E7E5E4] px-4 py-3">
              <div className="flex items-center gap-2">
                <Award size={18} className="text-[#FF6B35]" />
                <h2 className="text-sm font-bold text-[#1C1917]">Certificates Sidebar</h2>
              </div>
              <button
                type="button"
                onClick={() => setCertSidebarUserId(null)}
                className="rounded-md p-2 hover:bg-[#F5F5F4]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto h-[calc(100%-56px)]">
              {certLoading ? (
                <div className="text-sm text-[#78716C]">Loading certificates...</div>
              ) : candidateCertificates.length === 0 ? (
                <div className="text-sm text-[#78716C]">
                  No certificates found for this candidate.
                </div>
              ) : (
                candidateCertificates.map((cert) => (
                  <div
                    key={cert.id}
                    className="border border-[#E7E5E4] rounded-2xl p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] text-[#78716C] uppercase tracking-wide">
                          Course
                        </p>
                        <p className="text-sm font-semibold text-[#1C1917]">
                          {cert.courseName}
                        </p>
                        <p className="text-[11px] text-[#9CA3AF] mt-1">
                          ID: {cert.certificateNumber}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-[#78716C]">Score</p>
                        <p className="text-sm font-bold text-[#1C1917]">
                          {cert.score ?? 0}%
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#E7E5E4] space-y-2">
                      <p className="text-xs text-[#78716C]">
                        Upload / replace certificate file
                      </p>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          void handleUploadCertificate(cert, f).catch((err) =>
                            toast.error(String(err?.message || err)),
                          )
                        }}
                        className="block w-full text-xs text-[#78716C]"
                      />
                      {cert.certificateUrl ? (
                        <p className="text-[11px] text-green-700">Uploaded</p>
                      ) : (
                        <p className="text-[11px] text-[#78716C]">
                          Not uploaded yet
                        </p>
                      )}
                      {uploadingCertId === String(cert?.id || "") && (
                        <p className="text-[11px] text-[#78716C]">Uploading...</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
