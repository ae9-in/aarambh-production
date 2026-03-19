ALTER TABLE certificates
ADD COLUMN IF NOT EXISTS certificate_url TEXT;

ALTER TABLE certificates
ADD COLUMN IF NOT EXISTS certificate_public_id TEXT;

