-- "Super bots" — meta-bots that round-robin between 3 to 5 member bots
-- (custom / clone / neural). Each decision routes to one member; the
-- super bot picks a new member every random 1-3 turns. Capped at 2 per
-- user, off-quota from the 10-custom limit, still on-quota for public
-- sharing.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT FALSE;
-- Ordered list of member bot UUIDs (3..5 entries). NULL for non-super
-- rows; CHECK keeps the array length sane when populated.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS super_member_ids UUID[] DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bots_super_member_count'
  ) THEN
    ALTER TABLE bots ADD CONSTRAINT bots_super_member_count CHECK (
      (is_super = FALSE AND super_member_ids IS NULL)
      OR
      (is_super = TRUE AND array_length(super_member_ids, 1) BETWEEN 3 AND 5)
    );
  END IF;
END $$;

-- Partial index for the "list my super bots" lookup that drives the
-- collapsible section on /poker/bots. Cheap since most users have ≤2.
CREATE INDEX IF NOT EXISTS bots_super_owner_idx
  ON bots (owner_user_id) WHERE is_super = TRUE;
