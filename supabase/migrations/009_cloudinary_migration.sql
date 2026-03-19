ALTER TABLE content ADD COLUMN IF NOT EXISTS 
  cloudinary_public_id TEXT;

ALTER TABLE content ADD COLUMN IF NOT EXISTS 
  cloudinary_resource_type TEXT DEFAULT 'raw';

ALTER TABLE content DROP COLUMN IF EXISTS firebase_path;

