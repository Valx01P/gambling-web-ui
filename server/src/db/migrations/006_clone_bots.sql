-- Player-clone bot tiers (12 / 25 / 50 / 75 / 100 hands).
--
-- Each user has 5 reserved clone slots that can't be deleted, separate from
-- the 10-bot manual cap. A clone is identified by:
--   * is_clone = TRUE
--   * clone_tier in 1..5
--   * (owner_user_id, clone_tier) is unique — one bot per tier per user.
--
-- Clones default to private (is_public = FALSE) so a player's data-derived
-- bot isn't automatically visible to others. The owner can toggle this on.

ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_clone          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS clone_tier        SMALLINT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS clone_hands_used  INTEGER;

-- Hands-used must match an allowed tier when set. NULL means "not a clone".
-- ADD CONSTRAINT doesn't accept IF NOT EXISTS for CHECK constraints, so we
-- guard with a DO block that no-ops on a re-run of the migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bots_clone_tier_range'
  ) THEN
    ALTER TABLE bots
      ADD CONSTRAINT bots_clone_tier_range
      CHECK (clone_tier IS NULL OR (clone_tier BETWEEN 1 AND 5));
  END IF;
END $$;

-- Exactly one clone per tier per owner. Partial-unique on is_clone so the
-- 10 manual bots aren't constrained at all.
CREATE UNIQUE INDEX IF NOT EXISTS bots_clone_tier_unique
  ON bots (owner_user_id, clone_tier)
  WHERE is_clone = TRUE;

-- Roster query benefits from this when listing public bots — clones get
-- excluded by default unless their owner has manually shared them.
CREATE INDEX IF NOT EXISTS bots_public_non_clone_idx
  ON bots (is_public, is_clone, elo DESC)
  WHERE is_public = TRUE;
