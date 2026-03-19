"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Award, Calendar, Download } from "lucide-react"
import { toast } from "sonner"

const easeExpo = [0.16, 1, 0.3, 1]

type Certificate = {
  id: string
  courseName: string
  score: number
  certificateNumber: string
  createdAt: string
  contentId: string
  quizId: string | null
  certificateUrl: string | null
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return value
  }
}

export default function CertificatesPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [certificates, setCertificates] = useState<Certificate[]>([])

  // Use dynamic fetch so this page is always real (no dummy data).
  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const authRes = await fetch("/api/auth/me", { credentials: "include" })
        if (!authRes.ok) throw new Error("Not authenticated")
        const authJson = await authRes.json().catch(() => null)
        const userId = authJson?.profile?.id ?? authJson?.profile?.user_id ?? authJson?.id
        if (!userId) throw new Error("Missing user id")

        const res = await fetch(`/api/certificates?userId=${encodeURIComponent(userId)}`, {
          credentials: "include",
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || "Failed to load certificates")
        }
        const data = await res.json()
        if (cancelled) return
        setCertificates((data?.certificates ?? []) as Certificate[])
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || "Failed to load certificates")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const initialsByCourse = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of certificates) {
      const parts = String(c.courseName || "").trim().split(/\s+/).filter(Boolean)
      const init = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("")
      map.set(c.id, init || "A")
    }
    return map
  }, [certificates])

  const handleDownload = (cert: Certificate) => {
    if (!cert.certificateUrl) {
      toast.error("Certificate file is not available yet. Ask admin to upload it.")
      return
    }
    window.open(cert.certificateUrl, "_blank", "noopener,noreferrer")
  }

  if (isLoading) {
    return (
      <div className="min-h-screen px-6 py-6 max-w-2xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-[#F0EDE8] rounded animate-pulse" />
        <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-[#F0EDE8] rounded-3xl animate-pulse" />)}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-6 py-6 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: easeExpo }}>
        <h1 className="text-2xl font-bold text-[#1C1917]">My Certificates</h1>
        <p className="text-sm text-[#9CA3AF] mt-1">{certificates.length} certificates earned</p>
      </motion.div>

      {/* Certificates List */}
      <div className="space-y-4">
        {certificates.map((cert, idx) => (
          <motion.div
            key={cert.id}
            className="bg-white rounded-3xl border border-[#F0EDE8] overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1, ease: easeExpo }}
            whileHover={{ y: -2, boxShadow: "0 16px 48px rgba(0,0,0,0.08)" }}
          >
            {/* Certificate Preview */}
            <div className="relative h-32 overflow-hidden rounded-t-2xl bg-gradient-to-r from-[#FF6B35]/20 to-[#E85520]/10">
              <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #FF6B35 0, transparent 45%), radial-gradient(circle at 80% 40%, #E85520 0, transparent 50%)" }} />
              <div className="absolute bottom-0 left-0 right-0 p-6 z-10">
                <p className="text-[10px] text-[#FF6B35] font-mono uppercase tracking-wider">Certificate of Completion</p>
                <h3 className="text-lg font-bold text-white mt-1">{cert.courseName}</h3>
              </div>
            </div>

            {/* Certificate Details */}
            <div className="p-5">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <p className="text-[11px] text-[#9CA3AF] uppercase tracking-wide">Issued By</p>
                  <p className="font-medium text-[#1C1917]">Arambh Learning</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#9CA3AF] uppercase tracking-wide">Date</p>
                  <p className="font-medium text-[#1C1917] flex items-center gap-1">
                    <Calendar size={12} /> {formatDate(cert.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#9CA3AF] uppercase tracking-wide">Credential ID</p>
                  <p className="font-mono text-xs text-[#1C1917]">{cert.certificateNumber}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-5 pt-5 border-t border-[#F0EDE8]">
                <motion.button
                  onClick={() => handleDownload(cert)}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-gradient-to-r from-[#FF6B35] to-[#E85520] text-white text-sm font-medium"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Download size={16} /> Download
                </motion.button>
                <div className="flex-1" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {certificates.length === 0 && (
        <motion.div className="text-center py-16" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-[#FF6B35]/10 flex items-center justify-center">
            <Award size={32} className="text-[#FF6B35]" />
          </div>
          <h3 className="text-lg font-bold text-[#1C1917]">No certificates yet</h3>
          <p className="text-sm text-[#9CA3AF] mt-2">Complete courses to earn certificates</p>
        </motion.div>
      )}
    </div>
  )
}
