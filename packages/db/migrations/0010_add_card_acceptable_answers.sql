-- Free-recall (short/long answer) cards need a list of expected key terms or
-- phrases for server-side keyword-overlap grading. Stored as JSONB array of
-- strings; null for MCQ / flashcard cards.
ALTER TABLE "cards" ADD COLUMN "acceptable_answers" jsonb;
