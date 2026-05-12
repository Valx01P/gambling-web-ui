-- Dailies + achievements + skins.
--
-- daily_date_key is the UTC-date string the engine last bumped progress on.
-- When it doesn't match today's date, the user effectively gets a fresh
-- daily on their next hand (engine resets daily_progress to 0). All players
-- world-wide see the same daily for a given UTC date — see dailyPicker.js
-- (the date itself is the deterministic seed, no cron needed).
--
-- achievements is a JSONB array of string ids the user has unlocked.
-- Kept as a flat list rather than a join table because the cardinality is
-- in the dozens, not thousands — a single column read covers the profile.
--
-- skin_id 0 = default gray. 1-9 = preset skins (see client/lib/skinPresets.js).
-- 10 = custom skin (config in custom_skin column). Unlock tiers: 1, 5, 10,
-- 15, 20, 25, 30, 35, 40, 50 dailies completed lifetime.

ALTER TABLE users ADD COLUMN IF NOT EXISTS dailies_completed       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_date_key          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_progress          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_completed_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements            JSONB   NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skin_id                 INTEGER NOT NULL DEFAULT 0;
-- {colors: [...], direction: 'to right' | '90deg' | etc.}. Only meaningful
-- when skin_id = 10.
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_skin             JSONB;
