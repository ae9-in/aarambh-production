"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { FileText, Trash2, Upload, X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { toast } from "sonner"

type DocType = "SOP" | "LEAVE_POLICY" | "LEAVE_CALENDAR" | "OTHER"

type CompanyDoc = {
  id: string
  doc_type: DocType
  title: string
  description: string | null
  file_url: string
  firebase_path: string | null
  mime_type: string | null
  is_published: boolean
  created_at: string
}

async function uploadPdfToFirebase(file: File, orgId: string) {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("orgId", orgId)
  fd.append("fileType", "PDF")

  const res = await fetch("/api/upload/lesson-file", {
    method: "POST",
    body: fd,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || "File upload failed")
  }

  return (await res.json()) as { url: string; path: string; size: number }
}

export default function CompanyDocsAdminPage() {
  const { user } = useAuth()
  const [docType, setDocType] = useState<DocType>("SOP")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const [docs, setDocs] = useState<CompanyDoc[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  const canManage = useMemo(() => {
    const role = user?.role
    return ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role || "")
  }, [user?.role])

  useEffect(() => {
    if (!user?.orgId || !user?.id) return
    void (async () => {
      try {
        setLoadingDocs(true)
        const res = await fetch(
          `/api/company-docs?orgId=${encodeURIComponent(user.orgId)}&userId=${encodeURIComponent(
            user.id,
          )}`,
          { credentials: "include" },
        )
        if (!res.ok) throw new Error("Failed to load company documents.")
        const data = await res.json()
        setDocs((data?.documents || []) as CompanyDoc[])
      } catch (e: any) {
        console.error(e)
      } finally {
        setLoadingDocs(false)
      }
    })()
  }, [user?.orgId, user?.id])

  async function handleCreate() {
    if (!canManage) {
      toast.error("Insufficient permissions.")
      return
    }
    if (!user?.orgId || !user.id) {
      toast.error("Missing organization or user.")
      return
    }
    if (!file) {
      toast.error("Please select a PDF file.")
      return
    }
    if (!title.trim()) {
      toast.error("Title is required.")
      return
    }

    try {
      setUploading(true)

      const { url, path } = await uploadPdfToFirebase(file, user.orgId)

      const res = await fetch("/api/company-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: user.orgId,
          docType,
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          fileUrl: url,
          firebasePath: path,
          mimeType: file.type || "application/pdf",
          userId: user.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to save document.")
      }

      toast.success("Company document uploaded successfully.")
      setTitle("")
      setDescription("")
      setFile(null)

      const updated = await fetch(
        `/api/company-docs?orgId=${encodeURIComponent(user.orgId)}&userId=${encodeURIComponent(
          user.id,
        )}`,
        { credentials: "include" },
      )
      if (updated.ok) {
        const d = await updated.json()
        setDocs((d?.documents || []) as CompanyDoc[])
      }
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!user?.orgId || !user?.id) return
    if (!confirm("Delete this company document? This will remove it from storage too.")) return

    try {
      setUploading(true)
      const res = await fetch(`/api/company-docs/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, orgId: user.orgId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to delete document.")
      }

      toast.success("Deleted.")
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Delete failed.")
    } finally {
      setUploading(false)
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-3xl font-bold text-[#1C1917]"
        >
          Company Documents
        </motion.h1>
        <div className="bg-white rounded-xl border border-[#E7E5E4] p-6">
          <p className="text-[#78716C]">You don&apos;t have permission to manage company documents.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h1 className="text-3xl font-bold text-[#1C1917]">Company Documents</h1>
        <p className="text-[#78716C] mt-1">Upload SOP / Leave Policy / Leave Calendar PDFs</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-xl border border-[#E7E5E4] p-6">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#1C1917] block mb-2">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocType)}
                className="w-full px-3 py-2 border border-[#E7E5E4] rounded-lg"
              >
                <option value="SOP">SOP</option>
                <option value="LEAVE_POLICY">Leave Policy</option>
                <option value="LEAVE_CALENDAR">Leave Calendar</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-[#1C1917] block mb-2">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-[#E7E5E4] rounded-lg"
                placeholder="e.g., Employee Handbook SOP"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#1C1917] block mb-2">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-[#E7E5E4] rounded-lg resize-none"
                placeholder="Short info shown to employees"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#1C1917] block mb-2">PDF File</label>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="flex-1"
                />
                {file && (
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="p-2 rounded-lg hover:bg-[#F5F5F4] text-[#78716C]"
                    aria-label="Remove file"
                    title="Remove file"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {file && (
                <p className="text-xs text-[#78716C] mt-2">
                  Selected: <span className="font-medium text-[#1C1917]">{file.name}</span>
                </p>
              )}
            </div>

            <button
              onClick={() => void handleCreate()}
              disabled={uploading}
              className="w-full py-3.5 bg-[#FF6B35] text-white rounded-lg font-semibold hover:bg-[#E55A24] disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Upload Document"}
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E7E5E4] overflow-hidden">
          <div className="p-6 border-b border-[#E7E5E4] flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-[#1C1917]">Uploaded Documents</h2>
              <p className="text-[#78716C] mt-1">{docs.length} total</p>
            </div>
            <div className="text-sm text-[#78716C]">{loadingDocs ? "Loading..." : ""}</div>
          </div>

          <div className="p-6 space-y-3">
            {docs.length === 0 && !loadingDocs ? (
              <div className="text-[#78716C]">No documents uploaded yet.</div>
            ) : (
              docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start justify-between gap-3 p-4 rounded-xl border border-[#E7E5E4]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center">
                      <FileText size={18} className="text-[#FF6B35]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1C1917] truncate">{d.title}</p>
                      <p className="text-xs text-[#78716C] mt-1">{d.doc_type.replaceAll("_", " ")}</p>
                      {d.description ? (
                        <p className="text-xs text-[#78716C] mt-2 line-clamp-2">{d.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(d.id)}
                    disabled={uploading}
                    className="p-2 rounded-lg hover:bg-red-50 disabled:opacity-60"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={18} className="text-red-500" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

