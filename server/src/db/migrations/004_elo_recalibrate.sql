-- Recalibrate the bot rating system around a 500-baseline scale.
--
-- Old defaults: starting 1200, floor 100. The product copy now anchors:
--   300 = floor, 500 = beginner, 1000 = good, 1500 = excellent, 2000+ = elite.
--
-- Rebase everyone by shifting the old distribution down 700 points (1200 → 500
-- maps the previous starting point). Floor at 300 so stragglers don't drop
-- below the new minimum.

ALTER TABLE bots ALTER COLUMN elo SET DEFAULT 500;
UPDATE bots SET elo = GREATEST(300, elo - 700);

-- New per-bot counters used by the ELO engine for variety + bluff signals.
-- hands_voluntary  = total hands the bot put chips in by choice (call/raise),
--                    not just blinds. Drives the VPIP rate.
-- bluff_wins       = lifetime fold-out wins as the aggressor with a sub-50%
--                    preflop hand. Used in the variety multiplier.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS hands_voluntary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS bluff_wins INTEGER NOT NULL DEFAULT 0;

-- Per-hand audit row gets the same signals so we can backfill / recompute
-- the ELO offline without parsing action logs again.
ALTER TABLE bot_hand_results ADD COLUMN IF NOT EXISTS was_bluff_win BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_hand_results ADD COLUMN IF NOT EXISTS preflop_score REAL;
ALTER TABLE bot_hand_results ADD COLUMN IF NOT EXISTS performance_score REAL;
