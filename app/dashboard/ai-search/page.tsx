"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { MessageCircle, Send, Settings2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { toast } from "sonner"

const easeExpo = [0.16, 1, 0.3, 1]

export default function AISearchPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "Hi! I'm Arambh AI. Ask me anything about your training content." },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [searchDepth, setSearchDepth] = useState(3)
  const [language, setLanguage] = useState("EN")
  const [showSources, setShowSources] = useState(true)
  const [maxResults, setMaxResults] = useState("5")

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const depth = window.localStorage.getItem("arambh_search_depth")
      const lang = window.localStorage.getItem("arambh_search_lang")
      const sources = window.localStorage.getItem("arambh_show_sources")
      const max = window.localStorage.getItem("arambh_max_results")

      if (depth) setSearchDepth(Number(depth) || 3)
      if (lang) setLanguage(lang)
      if (sources !== null) setShowSources(sources !== "false")
      if (max) setMaxResults(max)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem("arambh_search_depth", String(searchDepth))
      window.localStorage.setItem("arambh_search_lang", language)
      window.localStorage.setItem("arambh_show_sources", String(showSources))
      window.localStorage.setItem("arambh_max_results", String(maxResults))
    } catch {
      // ignore
    }
  }, [searchDepth, language, showSources, maxResults])

  async function handleSend() {
    const question = input.trim()
    if (!question) return
    if (isLoading) return

    // Avoid silent failures: show a friendly assistant error bubble
    // if auth context isn't available yet.
    if (!user?.id || !user?.orgId) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question },
        {
          role: "assistant",
          content: "Please log in (and ensure your organization is active) to use AI search.",
        },
      ])
      setInput("")
      return
    }

    setInput("")
    setIsLoading(true)

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ])

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          userId: user.id,
          orgId: user.orgId,
          userRole: user.role,
          sessionId,
          categoryId: null,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error("AI chat request failed")
      }

      const nextSessionId = res.headers.get("x-chat-session-id")
      if (nextSessionId) setSessionId(nextSessionId)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let accumulated = ""

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        const chunk = decoder.decode(value || new Uint8Array(), { stream: !done })
        if (!chunk) continue
        accumulated += chunk
        setMessages((prev) => {
          // last assistant message is the one we just added
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], content: accumulated }
              break
            }
          }
          return next
        })
      }

      if (!accumulated.trim()) {
        setMessages((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = {
                ...next[i],
                content:
                  "This topic is not covered in your current training materials.",
              }
              break
            }
          }
          return next
        })
      }
    } catch (e) {
      console.error("AISearchPage chat error:", e)
      toast.error("Could not get AI response. Please try again.")
      setMessages((prev) => {
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = { ...next[i], content: "I could not process that right now. Please try again in a few seconds." }
            break
          }
        }
        return next
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: easeExpo }}>
        <h1 className="text-3xl font-bold text-[#1C1917]">AI Search Settings</h1>
        <p className="text-[#78716C] mt-1">Configure your AI search experience</p>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div className="lg:col-span-1 bg-white rounded-xl border border-[#E7E5E4] p-6" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="font-bold text-[#1C1917] mb-4 flex items-center gap-2"><Settings2 size={20} /> Search Settings</h2>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-[#1C1917]">Search Depth: {searchDepth}</label><input type="range" min="1" max="5" value={searchDepth} onChange={(e) => setSearchDepth(Number(e.target.value))} className="w-full mt-2" /></div>
            <div><label className="text-sm font-medium text-[#1C1917] block mb-2">Language</label><select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full px-3 py-2 border border-[#E7E5E4] rounded-lg"><option value="EN">English</option><option value="HI">Hindi</option></select></div>
            <div className="flex items-center justify-between"><label className="text-sm font-medium text-[#1C1917]">Show Sources</label><button onClick={() => setShowSources(!showSources)} className={`w-12 h-6 rounded-full transition-all ${showSources ? "bg-[#FF6B35]" : "bg-[#E7E5E4]"}`} /></div>
            <div><label className="text-sm font-medium text-[#1C1917] block mb-2">Max Results</label><select value={maxResults} onChange={(e) => setMaxResults(e.target.value)} className="w-full px-3 py-2 border border-[#E7E5E4] rounded-lg"><option>3</option><option>5</option><option>10</option></select></div>
          </div>
        </motion.div>

        <motion.div className="lg:col-span-2 bg-white rounded-xl border border-[#E7E5E4] flex flex-col h-96" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, idx) => (
              <motion.div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
                <div className={`max-w-xs px-4 py-2 rounded-lg ${msg.role === "user" ? "bg-[#FF6B35] text-white" : "bg-[#F5F5F4] text-[#1C1917]"}`}>{msg.content}</div>
              </motion.div>
            ))}
            {isLoading && <motion.div className="flex gap-2" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.5, repeat: Infinity }}><div className="w-2 h-2 bg-[#FF6B35] rounded-full" /><div className="w-2 h-2 bg-[#FF6B35] rounded-full" /><div className="w-2 h-2 bg-[#FF6B35] rounded-full" /></motion.div>}
          </div>
          <div className="border-t border-[#E7E5E4] p-4 flex gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleSend()} placeholder="Ask anything..." className="flex-1 px-4 py-2 border border-[#E7E5E4] rounded-lg focus:ring-2 focus:ring-[#FF6B35]/20 outline-none" />
            <button onClick={() => void handleSend()} className="p-2 bg-[#FF6B35] text-white rounded-lg hover:bg-[#E55A24]"><Send size={18} /></button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
