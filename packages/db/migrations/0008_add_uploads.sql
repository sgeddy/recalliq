-- Add userId to courses for user-generated courses
ALTER TABLE courses ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX courses_user_id_idx ON courses (user_id);

-- Upload status lifecycle
DO $$ BEGIN
  CREATE TYPE upload_status AS ENUM ('pending', 'processing', 'review', 'confirmed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Source type: file upload or URL
DO $$ BEGIN
  CREATE TYPE upload_source_type AS ENUM ('file', 'url');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Uploads: tracks the course-generation lifecycle
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  status upload_status NOT NULL DEFAULT 'pending',
  generated_payload JSONB,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX uploads_user_id_idx ON uploads (user_id);
CREATE INDEX uploads_status_idx ON uploads (status);

-- Upload sources: individual files or URLs attached to an upload
CREATE TABLE upload_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  source_type upload_source_type NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX upload_sources_upload_id_idx ON upload_sources (upload_id);
