-- Oracle bot: a single per-user omniscient slot.
--
-- Like neural slots (016) and clones, an Oracle bot is auto-provisioned for
-- each user and is permanent (you can't delete it). The runtime gives this
-- bot type a special "third-person spectator" ctx with everyone's hole cards
-- visible + exact equity computed against KNOWN holdings instead of inferred
-- ranges. The strategy still has to play smart — equity advantage isn't a
-- license to spam all-ins; sizing has to milk callers and the bot has to
-- mix in bluffs to keep ranges balanced.
--
-- Off-quota: doesn't count toward the 10 manual cap (countNonCloneBotsByOwner
-- excludes is_oracle). One per user only.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_oracle BOOLEAN NOT NULL DEFAULT FALSE;

-- One oracle per user. Partial unique index — only the rows where
-- is_oracle = TRUE are constrained, so regular bots are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS bots_owner_oracle_unique
  ON bots (owner_user_id) WHERE is_oracle = TRUE;
