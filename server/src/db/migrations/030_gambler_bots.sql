-- Gambler bots: a 5-bot loose-aggressive squad auto-provisioned for each
-- user, mirroring the pattern from 028_oracle_bot.sql but with 5 rows per
-- user (one per named strategy) instead of one. These bots pay to see
-- flops, chase draws, raise into perceived weakness, mix in bluffs, and
-- only fold to clearly strong opponent lines or with hands that have no
-- equity. They get their own category in the Add Bots picker.
--
-- Off-quota: gambler bots don't count toward the 10-manual cap (see
-- countNonCloneBotsByOwner). Private by default — is_public = FALSE.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_gambler BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per (owner, gambler-name). Partial unique index — only the rows
-- where is_gambler = TRUE are constrained, so a regular bot can share a
-- name with one of the gambler presets without conflict. The seeder uses
-- ON CONFLICT DO NOTHING against this index so the 5-bot batch is
-- idempotent across reloads / server restarts.
CREATE UNIQUE INDEX IF NOT EXISTS bots_owner_gambler_name_unique
  ON bots (owner_user_id, name) WHERE is_gambler = TRUE;
