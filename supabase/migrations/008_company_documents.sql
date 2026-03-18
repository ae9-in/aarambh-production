-- Company documents (SOP, Leave Policy, Leave Calendar, etc.)
-- Employees should read these PDFs; admins can upload/manage them.

CREATE TABLE IF NOT EXISTS company_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL
    CHECK (doc_type IN ('SOP', 'LEAVE_POLICY', 'LEAVE_CALENDAR', 'OTHER')),
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  firebase_path TEXT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_org_id ON company_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_company_documents_doc_type ON company_documents(doc_type);

ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;

-- Admins (HR/Managers) can manage all documents within their org.
CREATE POLICY "Admins can manage company documents"
  ON company_documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.org_id = company_documents.org_id
        AND p.role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER')
    )
  );

-- Employees can read only published docs in their org.
CREATE POLICY "Users can read published company documents in org"
  ON company_documents
  FOR SELECT
  USING (
    company_documents.is_published = true
    AND company_documents.org_id IN (
      SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION update_company_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_documents_updated_at ON company_documents;
CREATE TRIGGER trg_company_documents_updated_at
  BEFORE UPDATE ON company_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_company_documents_updated_at();

