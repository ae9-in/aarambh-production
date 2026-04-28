"use client"

import { useCallback, useEffect, useMemo, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  Upload, Search, Filter, MoreVertical, FileText, Video, Music, Image as ImageIcon,
  Folder, FolderPlus, Download, Trash2, Eye, Share2, X, ChevronRight,
  Grid3X3, List, Clock, HardDrive, CheckCircle2, AlertCircle, Plus
} from "lucide-react"

import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"

type FileItem = {
  id: string
  name: string
  type: "pdf" | "video" | "audio" | "image" | "document"
  size: string
  fileUrl: string | null
  uploadedBy: string
  uploadedAt: string
  folder: string
}

type FolderItem = {
  id: string
  name: string
  fileCount: number
  color: string
}

type PendingDelete = {
  kind: "file" | "folder"
  id: string
  name: string
} | null

const initialFolders: FolderItem[] = []
const initialFiles: FileItem[] = []

const FOLDER_COLORS = [
  "#FF6B35", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B",
  "#EF4444", "#06B6D4", "#EC4899", "#14B8A6", "#6366F1",
]

function formatBytes(input: unknown): string {
  try {
    const bytes = input == null ? 0n : BigInt(String(input))
    const units = ["B", "KB", "MB", "GB", "TB"] as const
    let value = bytes
    let unitIndex = 0
    while (value >= 1024n && unitIndex < units.length - 1) {
      value = value / 1024n
      unitIndex++
    }
    return `${value.toString()} ${units[unitIndex]}`
  } catch {
    return "—"
  }
}

function timeAgo(isoOrMs: string | number): string {
  const t = typeof isoOrMs === "number" ? isoOrMs : new Date(isoOrMs).getTime()
  if (!Number.isFinite(t)) return "—"
  const diffMs = Date.now() - t
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>(initialFiles)
  const [folders, setFolders] = useState<FolderItem[]>(initialFolders)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"grid" | "list">("list")
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [uploadFolderId, setUploadFolderId] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Create folder state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [newFolderDescription, setNewFolderDescription] = useState("")
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0])
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedFileForPreview, setSelectedFileForPreview] = useState<FileItem | null>(null)

  const [storageTotal, setStorageTotal] = useState<string>("—")
  const [storageUsed, setStorageUsed] = useState<string>("—")
  const [storagePercent, setStoragePercent] = useState<number>(0)

  const { user, isAdmin } = useAuth()

  const filteredFiles = files.filter(file => {
    const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFolder = !selectedFolder || file.folder === selectedFolder
    return matchesSearch && matchesFolder
  })

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf": return <FileText size={20} className="text-red-500" />
      case "video": return <Video size={20} className="text-purple-500" />
      case "audio": return <Music size={20} className="text-green-500" />
      case "image": return <ImageIcon size={20} className="text-blue-500" />
      default: return <FileText size={20} className="text-gray-500" />
    }
  }

  const getDocumentViewerUrl = (file: FileItem): string => {
    if (!file.fileUrl) return ""
    
    const lowerUrl = file.fileUrl.toLowerCase()
    const upperType = String(file.type || "").toUpperCase()
    const isPdf = upperType === "PDF" || lowerUrl.endsWith(".pdf")
    
    // Use the proxy API to ensure "inline" viewing (no download)
    const proxyUrl = `/api/content/${file.id}/document`

    if (isPdf) {
      // Direct iframe to the proxy is the most stable for PDFs
      return proxyUrl
    }

    // Office viewer for ppt/pptx/doc/docx/xls/xlsx
    const officeExtensions = [".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx"]
    if (officeExtensions.some((ext) => lowerUrl.includes(ext))) {
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.fileUrl)}`
    }

    // Fallback for other documents
    return proxyUrl
  }

  const loadData = useCallback(async () => {
    if (!user?.orgId || !user?.id) return

    try {
      setIsLoading(true)

      const qs = new URLSearchParams({
        orgId: user.orgId,
        userId: user.id,
        userRole: String(user.role ?? ""),
      }).toString()

      const [catRes, contentRes, storageRes] = await Promise.all([
        fetch(`/api/categories?${qs}`, { credentials: "include" }),
        fetch(`/api/content?${qs}`, { credentials: "include" }),
        fetch(`/api/storage-usage?orgId=${encodeURIComponent(user.orgId)}`, { credentials: "include" }),
      ])

      if (!catRes.ok) {
        const data = await catRes.json().catch(() => null)
        throw new Error(data?.error || "Failed to load folders")
      }
      if (!contentRes.ok) {
        const data = await contentRes.json().catch(() => null)
        throw new Error(data?.error || "Failed to load files")
      }

      const catJson = await catRes.json()
      const contentJson = await contentRes.json()
      const storageJson = storageRes.ok ? await storageRes.json().catch(() => null) : null

      const cats: any[] = catJson?.categories ?? []
      setFolders(
        cats.map((c) => ({
          id: String(c.id),
          name: String(c.name ?? "Category"),
          fileCount: Number(c.lesson_count ?? c.lessonCount ?? 0),
          color: String(c.color ?? "#FF6B35"),
        })),
      )
      
      if (cats.length > 0 && !uploadFolderId) {
        setUploadFolderId(String(cats[0].id))
      }

      const contentRows: any[] = contentJson?.content ?? []
      const typeMap: Record<string, FileItem["type"]> = {
        VIDEO: "video",
        PDF: "pdf",
        AUDIO: "audio",
        IMAGE: "image",
        NOTE: "document",
        PPT: "document",
        LINK: "document",
        QUIZ: "document",
      }

      const mappedFiles: FileItem[] = contentRows.map((r) => {
        const kind = typeMap[String(r.type)] ?? "document"
        return {
          id: String(r.id),
          name: String(r.title ?? "Untitled"),
          type: kind,
          size: formatBytes(r.file_size),
          fileUrl: r.file_url ? String(r.file_url) : null,
          uploadedBy: String(r.uploader_name ?? "Unknown"),
          uploadedAt: timeAgo(r.created_at),
          folder: String(r.category_name ?? "Uncategorized"),
        }
      })
      setFiles(mappedFiles)

      if (storageJson?.totalStorageGb != null) {
        setStorageTotal(`${Number(storageJson.totalStorageGb).toFixed(0)} GB`)
        setStorageUsed(`${storageJson.usedStorageGb ?? "0"} GB`)
        setStoragePercent(Number(storageJson.percent ?? 0))
      }
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Failed to load file library.")
    } finally {
      setIsLoading(false)
    }
  }, [user?.id, user?.orgId, user?.role])

  useEffect(() => {
    if (!user?.orgId || !user?.id) return
    void loadData()
    const t = setInterval(() => {
      void loadData()
    }, 5000)
    return () => clearInterval(t)
  }, [user?.orgId, user?.id, loadData])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleUpload = async (filesToUpload: FileList | File[]) => {
    if (!filesToUpload.length || !user?.orgId || !user?.id) return
    if (!uploadFolderId) {
      toast.error("Please select a folder first.")
      return
    }

    setIsUploading(true)
    setShowUploadModal(false)
    setUploadProgress(0)

    try {
      const totalFiles = filesToUpload.length
      let completedFiles = 0

      for (const file of Array.from(filesToUpload)) {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("orgId", user.orgId)
        formData.append("userId", user.id)
        formData.append("categoryId", uploadFolderId)

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Failed to upload ${file.name}`)
        }

        completedFiles++
        setUploadProgress(Math.round((completedFiles / totalFiles) * 100))
      }

      toast.success(`Successfully uploaded ${totalFiles} file(s).`)
      await loadData()
    } catch (e: any) {
      console.error(e)
      toast.error(e.message || "Upload failed.")
    } finally {
      setIsUploading(false)
      setTimeout(() => setUploadProgress(null), 2000)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files)
    }
  }, [user, uploadFolderId])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files)
      // Reset input so same file can be selected again
      e.target.value = ""
    }
  }

  const toggleFileSelection = (id: string) => {
    setSelectedFiles(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  const handleDelete = (id: string, name: string) => {
    if (!isAdmin) {
      toast.error("Only admins can delete files.")
      return
    }
    setPendingDelete({ kind: "file", id, name })
  }

  const handleDeleteFolder = (id: string, name: string) => {
    if (!isAdmin) {
      toast.error("Only admins can delete folders.")
      return
    }
    setPendingDelete({ kind: "folder", id, name })
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      const endpoint =
        pendingDelete.kind === "file"
          ? `/api/content/${pendingDelete.id}`
          : `/api/categories/${pendingDelete.id}`

      const res = await fetch(endpoint, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to delete")
      }

      if (pendingDelete.kind === "folder" && selectedFolder === pendingDelete.name) {
        setSelectedFolder(null)
      }

      await loadData()
      toast.success(pendingDelete.kind === "folder" ? "Folder deleted." : "File deleted.")
      setPendingDelete(null)
    } catch (e: any) {
      toast.error(e?.message || "Delete failed.")
    } finally {
      setIsDeleting(false)
    }
  }

  /* ─── Create Folder ─── */
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error("Please enter a folder name.")
      return
    }
    if (!user?.orgId || !user?.id) {
      toast.error("You must be logged in to create folders.")
      return
    }

    setIsCreatingFolder(true)
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orgId: user.orgId,
          name: newFolderName.trim(),
          description: newFolderDescription.trim() || null,
          color: newFolderColor,
          createdBy: user.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to create folder")
      }

      const data = await res.json()
      toast.success(`Folder "${newFolderName.trim()}" created!`)

      // Reset form
      setNewFolderName("")
      setNewFolderDescription("")
      setNewFolderColor(FOLDER_COLORS[0])
      setShowCreateFolderModal(false)

      // If we got back the new category, set it as the upload target
      if (data?.category?.id) {
        setUploadFolderId(String(data.category.id))
      }

      // Reload folders
      await loadData()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || "Failed to create folder.")
    } finally {
      setIsCreatingFolder(false)
    }
  }

  /* ─── Open upload modal pre-selecting a folder ─── */
  const openUploadForFolder = (folderId: string) => {
    setUploadFolderId(folderId)
    setShowUploadModal(true)
  }

  return (
    <div 
      className="min-h-screen p-3 sm:p-4 md:p-8"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#FF6B35]/10 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-white rounded-3xl p-12 border-2 border-dashed border-[#FF6B35] text-center"
            >
              <Upload size={48} className="mx-auto text-[#FF6B35] mb-4" />
              <h3 className="text-xl font-bold text-[#1C1917]">Drop files here</h3>
              <p className="text-[#78716C] mt-2">Release to upload your files</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress toast */}
      <AnimatePresence>
        {uploadProgress !== null && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-4 left-4 right-4 z-50 w-auto rounded-2xl border border-[#E7E5E4] bg-white p-4 shadow-2xl sm:left-auto sm:right-4 sm:w-80 md:bottom-8 md:right-8"
          >
            <div className="flex items-center gap-3 mb-3">
              {uploadProgress < 100 ? (
                <div className="w-10 h-10 rounded-full bg-[#FF6B35]/10 flex items-center justify-center">
                  <Upload size={20} className="text-[#FF6B35] animate-pulse" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 size={20} className="text-green-600" />
                </div>
              )}
              <div>
                <p className="font-medium text-[#1C1917]">
                  {uploadProgress < 100 ? "Uploading files..." : "Upload complete!"}
                </p>
                <p className="text-sm text-[#78716C]">
                  {uploadProgress}% complete
                </p>
              </div>
            </div>
            <div className="h-2 bg-[#E7E5E4] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[#FF6B35] rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1917]">File Library</h1>
          <p className="text-[#78716C] mt-1">Manage all your uploaded content</p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <motion.button
            onClick={() => setShowCreateFolderModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#FF6B35] px-5 py-2.5 font-medium text-[#FF6B35] transition-colors hover:bg-[#FF6B35]/5 sm:w-auto"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <FolderPlus size={18} />
            New Folder
          </motion.button>
          <motion.button
            onClick={() => setShowUploadModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B35] px-5 py-2.5 font-medium text-white transition-colors hover:bg-[#E85520] sm:w-auto"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Upload size={18} />
            Upload Files
          </motion.button>
        </div>
      </div>

      {/* Storage info */}
      <div className="bg-white rounded-2xl border border-[#E7E5E4] p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center">
              <HardDrive size={20} className="text-[#FF6B35]" />
            </div>
            <div>
              <p className="font-semibold text-[#1C1917]">Storage</p>
              <p className="text-sm text-[#78716C]">{storageUsed} of {storageTotal} used</p>
            </div>
          </div>
          <span className="text-2xl font-bold text-[#1C1917]">{storagePercent}%</span>
        </div>
        <div className="h-2 bg-[#E7E5E4] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ 
              background: storagePercent > 80 
                ? 'linear-gradient(90deg, #F59E0B, #EF4444)' 
                : 'linear-gradient(90deg, #FF6B35, #C8A96E)' 
            }}
            initial={{ width: 0 }}
            animate={{ width: `${storagePercent}%` }}
            transition={{ duration: 0.8 }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Sidebar - Folders */}
        <div className="w-full shrink-0 lg:w-64">
          <div className="bg-white rounded-2xl border border-[#E7E5E4] p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1C1917]">Folders</h3>
              <button
                onClick={() => setShowCreateFolderModal(true)}
                className="p-1.5 hover:bg-[#F5F5F4] rounded-lg transition-colors"
                title="Create new folder"
              >
                <FolderPlus size={18} className="text-[#78716C]" />
              </button>
            </div>

            <button
              onClick={() => setSelectedFolder(null)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors mb-2 ${
                selectedFolder === null ? "bg-[#FF6B35]/10 text-[#FF6B35]" : "hover:bg-[#F5F5F4] text-[#1C1917]"
              }`}
            >
              <Folder size={18} />
              <span className="flex-1 text-left text-sm font-medium">All Files</span>
              <span className="text-xs text-[#78716C]">{files.length}</span>
            </button>

            {folders.length === 0 && !isLoading && (
              <div className="text-center py-6 px-2">
                <Folder size={32} className="mx-auto text-[#D6D3D1] mb-2" />
                <p className="text-sm text-[#78716C] mb-3">No folders yet</p>
                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className="text-sm text-[#FF6B35] font-medium hover:underline"
                >
                  Create your first folder
                </button>
              </div>
            )}

            {folders.map((folder) => (
              <motion.div
                key={folder.id}
                className={`group w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${
                  selectedFolder === folder.name ? "bg-[#FF6B35]/10" : "hover:bg-[#F5F5F4]"
                }`}
                whileHover={{ x: 4 }}
              >
                <button
                  onClick={() => setSelectedFolder(folder.name)}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <div 
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${folder.color}20` }}
                  >
                    <Folder size={16} style={{ color: folder.color }} />
                  </div>
                  <span className={`flex-1 text-left text-sm font-medium truncate ${
                    selectedFolder === folder.name ? "text-[#FF6B35]" : "text-[#1C1917]"
                  }`}>
                    {folder.name}
                  </span>
                  <span className="text-xs text-[#78716C]">{folder.fileCount}</span>
                </button>
                {/* Upload to this folder button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openUploadForFolder(folder.id)
                  }}
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[#FF6B35]/10 transition-all"
                  title={`Upload to ${folder.name}`}
                >
                  <Upload size={14} className="text-[#FF6B35]" />
                </button>
                {isAdmin ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteFolder(folder.id, folder.name)
                    }}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all"
                    title={`Delete ${folder.name}`}
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                ) : null}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1">
          {/* Filters */}
          <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#78716C]" />
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-white border border-[#E7E5E4] rounded-xl text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:border-[#FF6B35]"
              />
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-[#E7E5E4] bg-white p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded-lg transition-colors ${viewMode === "grid" ? "bg-[#FF6B35] text-white" : "text-[#78716C] hover:bg-[#F5F5F4]"}`}
              >
                <Grid3X3 size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded-lg transition-colors ${viewMode === "list" ? "bg-[#FF6B35] text-white" : "text-[#78716C] hover:bg-[#F5F5F4]"}`}
              >
                <List size={16} />
              </button>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm mb-4">
            <button 
              onClick={() => setSelectedFolder(null)}
              className="text-[#78716C] hover:text-[#1C1917] transition-colors"
            >
              All Files
            </button>
            {selectedFolder && (
              <>
                <ChevronRight size={14} className="text-[#78716C]" />
                <span className="text-[#1C1917] font-medium">{selectedFolder}</span>
              </>
            )}
          </div>

          {/* Empty state when a folder is selected but has no files */}
          {selectedFolder && filteredFiles.length === 0 && !isLoading && (
            <div className="bg-white rounded-2xl border border-[#E7E5E4] p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#FF6B35]/10 flex items-center justify-center mx-auto mb-4">
                <Upload size={28} className="text-[#FF6B35]" />
              </div>
              <h3 className="text-lg font-semibold text-[#1C1917] mb-2">No files in this folder</h3>
              <p className="text-[#78716C] mb-4">Upload files to get started</p>
              <button
                onClick={() => {
                  const folder = folders.find(f => f.name === selectedFolder)
                  if (folder) openUploadForFolder(folder.id)
                  else setShowUploadModal(true)
                }}
                className="px-6 py-2.5 bg-[#FF6B35] text-white font-medium rounded-xl hover:bg-[#E85520] transition-colors"
              >
                Upload Files Here
              </button>
            </div>
          )}

          {/* Files */}
          {!(selectedFolder && filteredFiles.length === 0 && !isLoading) && viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              {filteredFiles.length === 0 ? (
                <div className="col-span-full text-center py-12 text-[#78716C]">
                  No files found.
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {filteredFiles.map((file, i) => (
                    <motion.div
                      key={file.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: i * 0.03 }}
                      className={`group bg-white rounded-2xl border p-4 cursor-pointer transition-all ${
                        selectedFiles.includes(file.id)
                          ? "border-[#FF6B35] shadow-lg shadow-[#FF6B35]/10"
                          : "border-[#E7E5E4] hover:border-[#FF6B35]/30"
                      }`}
                      onClick={() => toggleFileSelection(file.id)}
                    >
                      <div className="h-24 bg-[#F9FAFB] rounded-xl flex items-center justify-center mb-3 relative">
                        {getFileIcon(file.type)}
                        {isAdmin ? (
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(file.id, file.name) }}
                              className="p-1.5 bg-white rounded-lg shadow-md hover:bg-red-50 transition-colors"
                              title="Delete file"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <h4 className="font-medium text-[#1C1917] text-sm truncate">{file.name}</h4>
                      <div className="flex items-center justify-between mt-2 text-xs text-[#78716C]">
                        <span>{file.size}</span>
                        <span>{file.uploadedAt}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          ) : !(selectedFolder && filteredFiles.length === 0 && !isLoading) ? (
            <div className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
              <div className="space-y-2 p-3 md:hidden">
                {filteredFiles.length === 0 ? (
                  <div className="py-12 text-center text-[#78716C]">No files found.</div>
                ) : (
                  <AnimatePresence>
                    {filteredFiles.map((file, i) => (
                      <motion.div
                        key={`mobile-${file.id}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: i * 0.02 }}
                        className="rounded-xl border border-[#E7E5E4] bg-white p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5F5F4]">
                            {getFileIcon(file.type)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[#1C1917]">{file.name}</p>
                            <p className="text-xs text-[#78716C]">{file.size} • {file.uploadedAt}</p>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-[#78716C]">
                          Uploaded by {file.uploadedBy}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            className="rounded-lg border border-[#E7E5E4] px-3 py-2 text-xs text-[#1C1917]"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (file.fileUrl) setSelectedFileForPreview(file)
                              else toast.error("File URL not available.")
                            }}
                          >
                            View
                          </button>
                          <button
                            className="rounded-lg border border-[#E7E5E4] px-3 py-2 text-xs text-[#1C1917]"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (file.fileUrl) window.open(file.fileUrl, "_blank", "noopener,noreferrer")
                              else toast.error("File URL not available.")
                            }}
                          >
                            Download
                          </button>
                          {isAdmin ? (
                            <button
                              onClick={() => handleDelete(file.id, file.name)}
                              className="rounded-lg border border-red-200 p-2 text-red-600"
                              title="Delete file"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>

              <table className="hidden w-full md:table">
                <thead className="bg-[#F9FAFB] border-b border-[#E7E5E4]">
                  <tr>
                    <th className="w-8 px-4 py-3">
                      <input type="checkbox" className="rounded border-[#E7E5E4]" />
                    </th>
                    <th className="text-left text-xs font-semibold text-[#78716C] uppercase tracking-wider px-4 py-3">Name</th>
                    <th className="text-left text-xs font-semibold text-[#78716C] uppercase tracking-wider px-4 py-3">Size</th>
                    <th className="text-left text-xs font-semibold text-[#78716C] uppercase tracking-wider px-4 py-3">Uploaded By</th>
                    <th className="text-left text-xs font-semibold text-[#78716C] uppercase tracking-wider px-4 py-3">Date</th>
                    <th className="text-right text-xs font-semibold text-[#78716C] uppercase tracking-wider px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-[#78716C]">
                        No files found.
                      </td>
                    </tr>
                  ) : (
                    <AnimatePresence>
                      {filteredFiles.map((file, i) => (
                        <motion.tr
                          key={file.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b border-[#E7E5E4] hover:bg-[#F9FAFB] transition-colors group"
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedFiles.includes(file.id)}
                              onChange={() => toggleFileSelection(file.id)}
                              className="rounded border-[#E7E5E4]"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-[#F5F5F4] flex items-center justify-center">
                                {getFileIcon(file.type)}
                              </div>
                              <span className="font-medium text-[#1C1917]">{file.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#78716C]">{file.size}</td>
                          <td className="px-4 py-3 text-sm text-[#78716C]">{file.uploadedBy}</td>
                          <td className="px-4 py-3 text-sm text-[#78716C]">{file.uploadedAt}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-2 hover:bg-[#E7E5E4] rounded-lg transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (file.fileUrl)
                                    setSelectedFileForPreview(file)
                                  else toast.error("File URL not available.")
                                }}
                              >
                                <Eye size={16} className="text-[#78716C]" />
                              </button>
                              <button
                                className="p-2 hover:bg-[#E7E5E4] rounded-lg transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (file.fileUrl)
                                    window.open(file.fileUrl, "_blank", "noopener,noreferrer")
                                  else toast.error("File URL not available.")
                                }}
                              >
                                <Download size={16} className="text-[#78716C]" />
                              </button>
                              <button
                                className="p-2 hover:bg-[#E7E5E4] rounded-lg transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toast.info("Sharing is not wired up yet.")
                                }}
                              >
                                <Share2 size={16} className="text-[#78716C]" />
                              </button>
                              {isAdmin ? (
                                <button
                                  onClick={() => handleDelete(file.id, file.name)}
                                  className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                  title="Delete file"
                                >
                                  <Trash2 size={16} className="text-red-500" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {/* ─── Upload Modal ─── */}
      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={() => setShowUploadModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg rounded-t-3xl bg-white sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[#E7E5E4] flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1C1917]">Upload Files</h2>
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="p-2 hover:bg-[#F5F5F4] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[#78716C]" />
                </button>
              </div>

              <div className="p-6">
                {/* Folder selection FIRST */}
                <div className="mb-5">
                  <label className="block text-sm font-medium text-[#1C1917] mb-2">
                    Select Folder
                  </label>
                  <div className="flex gap-2">
                    <select 
                      value={uploadFolderId}
                      onChange={(e) => setUploadFolderId(e.target.value)}
                      className="flex-1 px-4 py-3 bg-[#F9FAFB] border border-[#E7E5E4] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#FF6B35]"
                    >
                      <option value="" disabled>Select a folder</option>
                      {folders.map(folder => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setShowUploadModal(false)
                        setShowCreateFolderModal(true)
                      }}
                      className="px-3 py-3 border border-[#E7E5E4] rounded-xl hover:bg-[#F5F5F4] transition-colors flex items-center gap-1.5 text-sm text-[#78716C] whitespace-nowrap"
                      title="Create new folder"
                    >
                      <Plus size={16} />
                      New
                    </button>
                  </div>
                  {folders.length === 0 && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                      <AlertCircle size={12} />
                      No folders yet. Create a folder first before uploading.
                    </p>
                  )}
                </div>

                {/* Drop zone */}
                <div 
                  className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${
                    !uploadFolderId 
                      ? "border-[#D6D3D1] bg-[#FAFAF9] cursor-not-allowed opacity-60" 
                      : "border-[#E7E5E4] hover:border-[#FF6B35] cursor-pointer"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!uploadFolderId) {
                      toast.error("Please select or create a folder first.")
                      return
                    }
                    if (e.dataTransfer.files) handleUpload(e.dataTransfer.files)
                  }}
                >
                  <Upload size={48} className="mx-auto text-[#78716C] mb-4" />
                  <h3 className="text-lg font-semibold text-[#1C1917] mb-2">
                    Drag and drop files here
                  </h3>
                  <p className="text-[#78716C] mb-4">or click to browse</p>
                  <input 
                    type="file" 
                    multiple 
                    id="file-library-upload-input"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    accept=".pdf,.doc,.docx,.mp4,.mp3,.png,.jpg,.jpeg,.gif,.webp,.ppt,.pptx,.wav,.m4a,.mov,.webm,.avif"
                    className="hidden"
                  />
                  <button 
                    type="button"
                    id="file-library-browse-btn"
                    disabled={isUploading || !uploadFolderId}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!uploadFolderId) {
                        toast.error("Please select or create a folder first.")
                        return
                      }
                      // Use setTimeout to ensure the click is not swallowed by the browser
                      setTimeout(() => {
                        fileInputRef.current?.click()
                      }, 0)
                    }}
                    className="px-6 py-2.5 bg-[#FF6B35] text-white font-medium rounded-xl hover:bg-[#E85520] transition-colors disabled:opacity-50"
                  >
                    {isUploading ? "Uploading..." : "Browse Files"}
                  </button>
                </div>

                <p className="text-xs text-[#78716C] mt-4">
                  Supported formats: PDF, DOC, DOCX, MP4, MP3, PNG, JPG, PPT, PPTX (max 500MB per file)
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Create Folder Modal ─── */}
      <AnimatePresence>
        {showCreateFolderModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={() => setShowCreateFolderModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md rounded-t-3xl bg-white sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[#E7E5E4] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center">
                    <FolderPlus size={20} className="text-[#FF6B35]" />
                  </div>
                  <h2 className="text-xl font-bold text-[#1C1917]">Create New Folder</h2>
                </div>
                <button
                  onClick={() => setShowCreateFolderModal(false)}
                  className="p-2 hover:bg-[#F5F5F4] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[#78716C]" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Folder name */}
                <div>
                  <label className="block text-sm font-medium text-[#1C1917] mb-2">
                    Folder Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Training Materials, Onboarding Videos..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isCreatingFolder) handleCreateFolder()
                    }}
                    className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E7E5E4] rounded-xl text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:border-[#FF6B35] transition-colors"
                    autoFocus
                  />
                </div>

                {/* Folder description */}
                <div>
                  <label className="block text-sm font-medium text-[#1C1917] mb-2">
                    Description <span className="text-[#78716C] font-normal">(optional)</span>
                  </label>
                  <textarea
                    placeholder="What kind of files will this folder contain?"
                    value={newFolderDescription}
                    onChange={(e) => setNewFolderDescription(e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E7E5E4] rounded-xl text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:border-[#FF6B35] transition-colors resize-none"
                  />
                </div>

                {/* Color picker */}
                <div>
                  <label className="block text-sm font-medium text-[#1C1917] mb-2">
                    Folder Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {FOLDER_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewFolderColor(color)}
                        className={`w-8 h-8 rounded-full transition-all ${
                          newFolderColor === color
                            ? "ring-2 ring-offset-2 ring-[#1C1917] scale-110"
                            : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-[#F9FAFB] rounded-xl p-4">
                  <p className="text-xs text-[#78716C] mb-2 uppercase tracking-wider font-medium">Preview</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${newFolderColor}20` }}
                    >
                      <Folder size={20} style={{ color: newFolderColor }} />
                    </div>
                    <div>
                      <p className="font-medium text-[#1C1917]">
                        {newFolderName.trim() || "Untitled Folder"}
                      </p>
                      {newFolderDescription.trim() && (
                        <p className="text-xs text-[#78716C] mt-0.5">
                          {newFolderDescription.trim()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => setShowCreateFolderModal(false)}
                    className="flex-1 px-5 py-3 border border-[#E7E5E4] text-[#1C1917] font-medium rounded-xl hover:bg-[#F5F5F4] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    disabled={isCreatingFolder || !newFolderName.trim()}
                    className="flex-1 px-5 py-3 bg-[#FF6B35] text-white font-medium rounded-xl hover:bg-[#E85520] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isCreatingFolder ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <FolderPlus size={18} />
                        Create Folder
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Delete Confirmation Modal ─── */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={() => {
              if (!isDeleting) setPendingDelete(null)
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md rounded-t-3xl bg-white sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[#E7E5E4] flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#1C1917]">Confirm Delete</h2>
                  <p className="text-sm text-[#78716C]">
                    {pendingDelete.kind === "folder"
                      ? `Delete folder "${pendingDelete.name}" and all files inside it?`
                      : `Delete file "${pendingDelete.name}"?`}
                  </p>
                </div>
              </div>

              <div className="p-6 flex items-center gap-3">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={isDeleting}
                  className="flex-1 px-5 py-3 border border-[#E7E5E4] text-[#1C1917] font-medium rounded-xl hover:bg-[#F5F5F4] transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex-1 px-5 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── File Preview Modal ─── */}
      <AnimatePresence>
        {selectedFileForPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 md:p-8"
            onClick={() => setSelectedFileForPreview(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-6xl h-full max-h-[90vh] bg-[#1C1917] rounded-3xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Preview Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#1C1917]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    {getFileIcon(selectedFileForPreview.type)}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold truncate max-w-[200px] sm:max-w-md">
                      {selectedFileForPreview.name}
                    </h3>
                    <p className="text-white/40 text-xs">
                      {selectedFileForPreview.type.toUpperCase()} • {selectedFileForPreview.size}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={selectedFileForPreview.fileUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
                    title="Download original"
                  >
                    <Download size={20} />
                  </a>
                  <button
                    onClick={() => setSelectedFileForPreview(null)}
                    className="p-2 bg-white/10 text-white rounded-lg hover:bg-red-500 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Preview Content */}
              <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
                {selectedFileForPreview.type === "video" ? (
                  <video
                    src={selectedFileForPreview.fileUrl!}
                    controls
                    autoPlay
                    className="max-w-full max-h-full"
                  />
                ) : selectedFileForPreview.type === "image" ? (
                  <img
                    src={selectedFileForPreview.fileUrl!}
                    alt={selectedFileForPreview.name}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <iframe
                    src={getDocumentViewerUrl(selectedFileForPreview)}
                    className="w-full h-full border-0"
                    title="File Preview"
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
