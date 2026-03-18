-- Q&A entries for training the AI on curated questions/answers
CREATE TABLE IF NOT EXISTS ai_qna_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Basic indexes for common filters
CREATE INDEX IF NOT EXISTS idx_ai_qna_entries_org_id ON ai_qna_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_qna_entries_category_id ON ai_qna_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ai_qna_entries_tags ON ai_qna_entries USING GIN(tags);

-- Enable RLS and add minimal policies
ALTER TABLE ai_qna_entries ENABLE ROW LEVEL SECURITY;

-- Admins/managers can manage Q&A within their org
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_qna_entries'
      AND policyname = 'Admins manage ai_qna_entries'
  ) THEN
    CREATE POLICY "Admins manage ai_qna_entries"
      ON ai_qna_entries
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('ADMIN','SUPER_ADMIN','MANAGER')
            AND p.org_id = ai_qna_entries.org_id
        )
      );
  END IF;
END $$;

-- All org members can read Q&A for their org (for RAG)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_qna_entries'
      AND policyname = 'Org members read ai_qna_entries'
  ) THEN
    CREATE POLICY "Org members read ai_qna_entries"
      ON ai_qna_entries
      FOR SELECT
      USING (
        org_id IN (
          SELECT org_id FROM profiles
          WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- Extend ai_chunks with source metadata for lessons, policies, and Q&A
ALTER TABLE ai_chunks
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'lesson'
    CHECK (source_type IN ('lesson','policy','qna')),
  ADD COLUMN IF NOT EXISTS qna_id UUID REFERENCES ai_qna_entries(id) ON DELETE CASCADE;

