import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.warn(
    'Cloudinary env vars missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
  )
}

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
  secure: true,
})

export type CloudinaryUploadResult = {
  secureUrl: string
  publicId: string
  resourceType: 'image' | 'video' | 'raw'
}

export async function uploadToCloudinary(
  buffer: Buffer,
  originalFilename: string,
  fileType: string,
): Promise<CloudinaryUploadResult> {
  const upperType = (fileType || '').toUpperCase()

  let resourceType: CloudinaryUploadResult['resourceType'] = 'raw'
  if (upperType === 'VIDEO' || upperType === 'AUDIO') {
    resourceType = 'video'
  } else if (upperType === 'IMAGE') {
    resourceType = 'image'
  } else {
    resourceType = 'raw'
  }

  const folders: Record<string, string> = {
    VIDEO: 'arambh/videos',
    PDF: 'arambh/documents',
    AUDIO: 'arambh/audio',
    PPT: 'arambh/presentations',
    IMAGE: 'arambh/images',
    NOTE: 'arambh/notes',
  }

  const cleanName = originalFilename
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '-')
    .replace(/-+/g, '-')

  const folder = folders[upperType] || 'arambh/notes'
  const publicId = `${folder}/${Date.now()}-${cleanName}`.replace(/\.[^.]+$/, '')

  const uploadResult: UploadApiResponse = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        public_id: publicId,
      },
      (error, result) => {
        if (error || !result) return reject(error)
        resolve(result)
      },
    )
    stream.end(buffer)
  })

  return {
    secureUrl: uploadResult.secure_url!,
    publicId: uploadResult.public_id!,
    resourceType,
  }
}

export async function deleteFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'raw',
): Promise<boolean> {
  if (!publicId) return true

  try {
    const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
    if (res.result === 'ok' || res.result === 'not found') {
      return true
    }
    console.error('Cloudinary delete unexpected result:', res)
    return false
  } catch (e) {
    console.error('Cloudinary delete error:', e)
    return false
  }
}

export function getOptimizedUrl(publicId: string, type: string): string {
  const upperType = (type || '').toUpperCase()

  if (!publicId) return ''

  if (upperType === 'VIDEO' || upperType === 'AUDIO') {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    })
  }

  if (upperType === 'IMAGE') {
    return cloudinary.url(publicId, {
      resource_type: 'image',
      transformation: [{ width: 800, quality: 'auto', fetch_format: 'auto', crop: 'limit' }],
    })
  }

  return cloudinary.url(publicId, {
    resource_type: 'raw',
  })
}

export function detectResourceType(mimeType: string, fileName: string): 'image' | 'video' | 'raw' {
  const mime = (mimeType || '').toLowerCase()
  const name = (fileName || '').toLowerCase()

  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'video'
  if (mime.startsWith('image/')) return 'image'

  if (name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm')) return 'video'
  if (name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a')) return 'video'
  if (name.match(/\.(png|jpe?g|gif|webp|avif)$/)) return 'image'

  return 'raw'
}

export function detectType(mime: string, name: string): string {
  if (mime.includes('video')) return 'VIDEO'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.includes('audio')) return 'AUDIO'
  if (
    mime.includes('presentation') ||
    name.endsWith('.ppt') ||
    name.endsWith('.pptx')
  )
    return 'PPT'
  if (mime.includes('image')) return 'IMAGE'
  return 'NOTE'
}

// Cloudinary dashboard expectations:
// - Settings → Upload: server-side authenticated uploads only (no unsigned upload needed).
// - Settings → Security: ensure API key/secret match this environment.
// - Media Library: create folders:
//   arambh/videos, arambh/documents, arambh/audio, arambh/presentations, arambh/images, arambh/notes.

