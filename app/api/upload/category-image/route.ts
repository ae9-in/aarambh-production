import { NextResponse } from "next/server"
import { v2 as cloudinary } from "cloudinary"

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.warn("Cloudinary env vars missing for category image upload route.")
}

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
  secure: true,
})

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const orgId = formData.get("orgId") as string | null

    if (!file || !orgId) {
      return NextResponse.json(
        { error: "Missing file or orgId" },
        { status: 400 },
      )
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image uploads are allowed." },
        { status: 400 },
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ts = Date.now()
    const clean = file.name.toLowerCase().replace(/[^a-z0-9.]/g, "-").replace(/-+/g, "-")
    const publicId = `orgs/${orgId}/categories/${ts}-${clean}`.replace(/\.[^.]+$/, "")

    const result = await new Promise<cloudinary.UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: undefined,
          public_id: publicId,
          resource_type: "image",
        },
        (error, res) => {
          if (error || !res) return reject(error)
          resolve(res)
        },
      )
      stream.end(buffer)
    })

    return NextResponse.json({
      imageUrl: result.secure_url,
      orgId,
    })
  } catch (e: any) {
    console.error("Cloudinary category upload error:", e)
    const message = e?.message || "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
