"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ArrowLeft, FileText, ExternalLink } from "lucide-react"
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

export default function CompanyDocViewer({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth()
  const router = useRouter()
  const [docId, setDocId] = useState<string | null>(null)
  const [doc, setDoc] = useState<CompanyDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then(({ id }) => setDocId(id))
  }, [params])

  const docTypeLabel = useMemo(() => {
    if (!doc) return ""
    return doc.doc_type.replaceAll("_", " ")
  }, [doc])

  useEffect(() => {
    if (!docId || !user?.orgId || !user?.id) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/company-docs/${encodeURIComponent(docId)}?orgId=${encodeURIComponent(
            user.orgId,
          )}&userId=${encodeURIComponent(user.id)}`,
          { credentials: "include" },
        )
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || "Failed to load document.")
        }
        const data = await res.json()
        setDoc(data.document as CompanyDoc)
      } catch (e: any) {
        console.error(e)
        setError(e?.message || "Failed to load document.")
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [docId, user?.orgId, user?.id])

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-6 bg-[#FAF9F7]">
        <div className="h-8 w-56 bg-[#F0EDE8] rounded animate-pulse" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-red-600 text-sm mb-4">{error || "Document not found"}</p>
          <Link href="/learn/company-docs" className="text-[#FF6B35] hover:underline">
            Back to Company Documents
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF9F7] px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 text-[#1C1917] hover:underline"
            >
              <ArrowLeft size={18} /> Back
            </button>
            <span className="inline-flex items-center gap-2 text-sm text-[#78716C]">
              <FileText size={16} /> {docTypeLabel}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#1C1917] mt-2">{doc.title}</h1>
          {doc.description ? <p className="text-sm text-[#78716C] mt-1">{doc.description}</p> : null}
        </motion.div>

        <div className="bg-white rounded-2xl border border-[#F0EDE8] overflow-hidden">
          <div className="p-4 border-b border-[#F0EDE8] flex items-center justify-between gap-3">
            <p className="text-sm text-[#78716C]">PDF Viewer</p>
            <a
              href={doc.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FF6B35] text-white text-sm font-bold hover:bg-[#E55A24]"
            >
              Open in new tab <ExternalLink size={16} />
            </a>
          </div>
          <div className="w-full" style={{ height: "calc(100vh - 220px)" }}>
            {/* Chrome-like PDF experience via the browser's built-in viewer */}
            <iframe
              src={`${doc.file_url}#toolbar=1`}
              className="w-full h-full border-0"
              title={doc.title}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

