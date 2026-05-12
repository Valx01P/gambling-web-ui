-- Per-user "luck" counters surfaced as a small profile stat.
--
-- Two independent streams roll up into the single displayed luck score:
--   1. Side bets:  side_bets_won + side_bets_lost (and chip P/L) are
--      tracked on every resolved position. `side_bet_longshot_wins` is
--      the subset where the player bought in at a low displayed price
--      (<30%) and still won — that's the part that signals "lucky" vs
--      "made +EV picks that paid out at fair frequency".
--   2. All-in showdowns:  every showdown where the user was all-in
--      bumps `all_in_showdowns`. If they were the equity underdog at
--      the moment of the all-in AND won the hand, `all_in_underdog_wins`
--      ticks up.
--
-- Aggregates only — no per-event row. Keeps storage flat and reads cheap.
-- The derived luck_score (0-10) is computed on read, not stored.

ALTER TABLE users ADD COLUMN IF NOT EXISTS side_bets_won INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS side_bets_lost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS side_bet_longshot_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS side_bet_chip_pl BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS all_in_showdowns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS all_in_underdog_wins INTEGER NOT NULL DEFAULT 0;
