import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'buffer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const storageAdmin = createClient(supabaseUrl, serviceKey)

export const runtime = 'nodejs'

async function ensureAvatarsBucket() {
  try {
    // If the bucket already exists, Supabase will throw; we ignore that.
    await storageAdmin.storage.createBucket('avatars', { public: true })
  } catch {
    // no-op: bucket likely already exists
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as any
    const userId = formData.get('userId') as string | null

    const hasArrayBuffer = Boolean(file && typeof file.arrayBuffer === 'function')
    if (!hasArrayBuffer || !userId) {
      return NextResponse.json(
        { error: 'Missing file or userId' },
        { status: 400 },
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const path = `${userId}/avatar.jpg`

    await ensureAvatarsBucket()

    const { error: uploadError } = await storageAdmin.storage.from('avatars').upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    })

    if (uploadError) {
      console.error('avatar upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload avatar', details: uploadError?.message || String(uploadError) },
        { status: 500 },
      )
    }

    const {
      data: { publicUrl },
    } = storageAdmin.storage.from('avatars').getPublicUrl(path)

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)

    if (updateError) {
      console.error('avatar profile update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update profile', details: updateError?.message || String(updateError) },
        { status: 500 },
      )
    }

    return NextResponse.json({ avatarUrl: publicUrl })
  } catch (e) {
    console.error('POST /api/upload/avatar unexpected:', e)
    return NextResponse.json(
      { error: 'Unexpected error', details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

