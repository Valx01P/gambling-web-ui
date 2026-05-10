-- Free-form JavaScript bot logic. When `code_enabled` is true, the runtime calls
-- decide(ctx) instead of the rule DSL. `code` is plain text (we never eval through
-- the column itself; the runtime sandbox is what executes it).
ALTER TABLE bots ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS code_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bots_code_length'
  ) THEN
    ALTER TABLE bots ADD CONSTRAINT bots_code_length CHECK (char_length(code) <= 32768);
  END IF;
END $$;
