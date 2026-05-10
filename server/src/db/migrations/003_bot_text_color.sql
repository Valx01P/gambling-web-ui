-- Per-bot text color override on the avatar.
-- 'auto' (default) picks white/black via Rec.709 luma; 'white' / 'black' force.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS text_color TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bots_text_color_value'
  ) THEN
    ALTER TABLE bots ADD CONSTRAINT bots_text_color_value
      CHECK (text_color IN ('auto', 'white', 'black'));
  END IF;
END $$;
