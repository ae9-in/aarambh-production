import Groq from "groq-sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"

const groqApiKey = process.env.GROQ_API_KEY
const geminiApiKey = process.env.GEMINI_API_KEY

const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null
export async function createEmbedding(text: string): Promise<number[] | null> {
  try {
    if (!genAI) return null
    const cleaned = String(text || "").trim()
    if (!cleaned) return null

    const modelNames = ["embedding-004", "text-embedding-004", "gemini-embedding-001"]
    for (const modelName of modelNames) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName })
        const result: any = await model.embedContent(cleaned)
        const values = result?.embedding?.values
        if (!Array.isArray(values)) continue
        const numeric = values.map((v) => Number(v))
        if (numeric.length === 1536) return numeric
        if (numeric.length > 1536) return numeric.slice(0, 1536)
        return [...numeric, ...new Array(1536 - numeric.length).fill(0)]
      } catch (error) {
        console.warn(`Embedding failed for model ${modelName}:`, error)
      }
    }
    return null
  } catch (error) {
    console.error("createEmbedding error:", error)
    return null
  }
}

export async function askGroq(
  systemPrompt: string,
  userQuestion: string,
): Promise<string> {
  if (!groq) throw new Error("GROQ_API_KEY is missing")
  const res = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    max_tokens: 1024,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuestion },
    ],
  })
  return String(res.choices?.[0]?.message?.content || "")
}

export async function streamGroq(systemPrompt: string, userQuestion: string) {
  if (!groq) throw new Error("GROQ_API_KEY is missing")
  return groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    max_tokens: 1024,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuestion },
    ],
  })
}

