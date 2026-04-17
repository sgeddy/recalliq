-- Add content_type to uploads so the worker knows which AI model to use.
-- 'practice_exam' → Haiku (fast extraction), 'study_guide' or 'mixed' → Sonnet (generation).
ALTER TABLE uploads ADD COLUMN content_type TEXT NOT NULL DEFAULT 'practice_exam';
