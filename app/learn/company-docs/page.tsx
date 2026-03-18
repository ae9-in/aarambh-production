"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import type { ComponentType } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { FileText, ChevronRight, BookOpen, CalendarDays } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

type DocType = "SOP" | "LEAVE_POLICY" | "LEAVE_CALENDAR" | "OTHER"

type CompanyDoc = {
  id: string
  org_id: string
  doc_type: DocType
  title: string
  description: string | null
  file_url: string
  mime_type: string | null
  is_published: boolean
  created_at: string
}

const typeMeta: Record<string, { label: string; icon: ComponentType<{ size?: number; className?: string }> }> = {
  SOP: { label: "Company SOP", icon: BookOpen },
  LEAVE_POLICY: { label: "Leave Policy", icon: FileText },
  LEAVE_CALENDAR: { label: "Leave Calendar", icon: CalendarDays },
  OTHER: { label: "Other Documents", icon: FileText },
}

function normalizeQueryType(value: string | null): DocType | null {
  if (!value) return null
  const v = value.toUpperCase()
  if (v === "SOP") return "SOP"
  if (v === "LEAVE_POLICY") return "LEAVE_POLICY"
  if (v === "LEAVE_CALENDAR") return "LEAVE_CALENDAR"
  if (v === "OTHER") return "OTHER"
  return null
}

function CompanyDocsPageInner() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedType = useMemo(() => normalizeQueryType(searchParams.get("docType") || searchParams.get("type")), [searchParams])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<CompanyDoc[]>([])

  useEffect(() => {
    if (!user?.orgId || !user?.id) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set("orgId", user.orgId)
        params.set("userId", user.id)
        if (selectedType) params.set("docType", selectedType)

        const res = await fetch(`/api/company-docs?${params.toString()}`, { credentials: "include" })
        if (!res.ok) throw new Error("Failed to load company documents.")
        const data = await res.json()
        setDocuments((data?.documents || []) as CompanyDoc[])
      } catch (e: any) {
        console.error(e)
        setError(e?.message || "Failed to load company documents.")
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [user?.orgId, user?.id, selectedType])

  const tabs = useMemo(() => {
    return [
      { key: "ALL", label: "Company Documents" },
      { key: "SOP", label: typeMeta.SOP.label },
      { key: "LEAVE_POLICY", label: typeMeta.LEAVE_POLICY.label },
      { key: "LEAVE_CALENDAR", label: typeMeta.LEAVE_CALENDAR.label },
      { key: "OTHER", label: typeMeta.OTHER.label },
    ]
  }, [])

  function setTab(key: string) {
    if (!key || key === "ALL") {
      router.push("/learn/company-docs")
      return
    }
    router.push(`/learn/company-docs?docType=${encodeURIComponent(key)}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-6 space-y-6">
        <div className="h-8 w-56 bg-[#F0EDE8] rounded animate-pulse" />
        <div className="h-10 w-full bg-[#F0EDE8] rounded animate-pulse" />
      </div>
    )
  }

  return (
    <div className="min-h-screen px-6 py-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.35 }}
      >
        <h1 className="text-2xl font-bold text-[#1C1917]">Company Documents</h1>
        <p className="text-sm text-[#78716C] mt-1">
          {selectedType
            ? typeMeta[selectedType]?.label
            : "SOP, Leave Policy, and other official documents"}
        </p>
      </motion.div>

      <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => {
          const active = (t.key === "ALL" && !selectedType) || selectedType === (t.key as any)
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                active ? "bg-[#FF6B35] text-white" : "bg-white border border-[#F0EDE8] text-[#1C1917] hover:border-[#FF6B35]"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : documents.length === 0 ? (
        <div className="text-sm text-[#78716C]">No documents found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {documents.map((d, idx) => {
            const metaIcon = selectedType ? typeMeta[selectedType]?.icon : typeMeta[d.doc_type]?.icon
            const Icon = metaIcon || FileText
            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="bg-white rounded-2xl border border-[#F0EDE8] p-5 flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={18} className="text-[#FF6B35]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-[#FF6B35] font-medium uppercase tracking-wide">
                      {d.doc_type.replaceAll("_", " ")}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-[#1C1917] truncate">{d.title}</h3>
                    {d.description ? (
                      <p className="text-sm text-[#78716C] mt-2 line-clamp-2">{d.description}</p>
                    ) : null}
                  </div>
                </div>
                <Link
                  href={`/learn/company-docs/${d.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF6B35] text-white text-sm font-bold hover:bg-[#E55A24] transition-colors"
                >
                  View <ChevronRight size={16} />
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function CompanyDocsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen px-6 py-6 space-y-6">
          <div className="h-8 w-56 bg-[#F0EDE8] rounded animate-pulse" />
          <div className="h-10 w-full bg-[#F0EDE8] rounded animate-pulse" />
        </div>
      }
    >
      <CompanyDocsPageInner />
    </Suspense>
  )
}

