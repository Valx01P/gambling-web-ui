-- Neural-net bot type. Like clones (is_clone), these are auto-provisioned per
-- user and permanent — you can't delete them. Two slots per user, indexed by
-- neural_tier (1 or 2). `neural_state` is the full model state as JSONB:
-- { version, weights[6][15], handsTrained, rewardHistory, actionCounts,
--   lastUpdatedAt }. Weight matrix is small (90 floats) so it fits easily in
-- a row; we never query into it, only read/write the whole blob.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_neural BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS neural_tier SMALLINT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS neural_state JSONB;

-- One bot per (owner, tier). Mirrors the clone uniqueness pattern so the
-- auto-provisioner can INSERT ... ON CONFLICT DO NOTHING.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bots_owner_neural_tier_unique'
  ) THEN
    ALTER TABLE bots ADD CONSTRAINT bots_owner_neural_tier_unique
      UNIQUE (owner_user_id, neural_tier);
  END IF;
END $$;

-- Partial index for the runtime lookup "does this user have neural bots yet?"
CREATE INDEX IF NOT EXISTS bots_neural_owner_idx
  ON bots (owner_user_id) WHERE is_neural = TRUE;
