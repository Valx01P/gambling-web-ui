-- Signed-in humans become first-class participants in the same ELO pool
-- bots live in. Adds:
--   1. users.elo (+ a small audit row table mirroring bot_hand_results)
--   2. user_hand_archive — unbounded full hand history, indexed by day,
--      separate from the existing rolling 100 (user_hand_history) which the
--      bot generator still wants as a hot cache.
--   3. user_daily_activity — per-day rollup used by the profile calendar.
--   4. user_rivalries — per-opponent net chip flow so we can answer
--      "who has this player lost the most chips to?"
--
-- Storage rationale: Postgres. Hand records are tiny (<1 KB compressed
-- JSONB), the access patterns are by user + day + recency, and partitioning
-- can be added later by month if we ever hit millions of rows. Keeping
-- everything in one system also lets the export endpoint stream straight
-- out of the DB without crossing into S3.

-- ---------------------------------------------------------------------------
-- 1. Users get an ELO + lifetime poker counters. Default 500 matches what
--    bot_hand_results uses post-recalibration (migration 004). Floor at 300
--    so a streak of losses can't drop a player off the rating scale.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER NOT NULL DEFAULT 500;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hands_played INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hands_won INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chips_won_total BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_elo_floor'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_elo_floor CHECK (elo >= 300);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_elo_idx ON users (elo DESC);

-- ---------------------------------------------------------------------------
-- 2. Full per-hand archive. Distinct from user_hand_history (rolling 100,
--    pruned on insert) — this table is unbounded so every hand stays
--    available for replay + export. The `played_day` generated column
--    answers "what hands did I play on YYYY-MM-DD?" in one indexed seek.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_hand_archive (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  table_id          TEXT NOT NULL,
  played_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  played_day        DATE GENERATED ALWAYS AS ((played_at AT TIME ZONE 'UTC')::date) STORED,
  chips_delta       INTEGER NOT NULL,
  won               BOOLEAN NOT NULL DEFAULT FALSE,
  went_to_showdown  BOOLEAN NOT NULL DEFAULT FALSE,
  voluntarily_in    BOOLEAN NOT NULL DEFAULT FALSE,
  folded_preflop    BOOLEAN NOT NULL DEFAULT FALSE,
  elo_before        INTEGER NOT NULL,
  elo_after         INTEGER NOT NULL,
  elo_delta         INTEGER NOT NULL,
  data              JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS user_hand_archive_user_played_idx
  ON user_hand_archive (user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS user_hand_archive_user_day_idx
  ON user_hand_archive (user_id, played_day);

-- ---------------------------------------------------------------------------
-- 3. Per-day rollup. Upserted by the application on every recorded hand.
--    Picks up the user's ELO at first and last hand of the day so the
--    calendar UI can plot a clean per-day curve without scanning every
--    archive row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  hands_played   INTEGER NOT NULL DEFAULT 0,
  hands_won      INTEGER NOT NULL DEFAULT 0,
  chips_delta    BIGINT  NOT NULL DEFAULT 0,
  elo_start      INTEGER NOT NULL,
  elo_end        INTEGER NOT NULL,
  first_hand_at  TIMESTAMPTZ NOT NULL,
  last_hand_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS user_daily_activity_day_idx ON user_daily_activity (day);

-- ---------------------------------------------------------------------------
-- 4. Per-opponent rivalry tracker. opponent_kind splits 'user' vs 'bot' so
--    the same display logic can resolve names from either source. chips_net
--    is the *user's* net flow vs this opponent — strongly negative means
--    "they've been taking my money". opponent_name is denormalized for
--    cheap reads; we keep it loosely in sync (best-effort updates on write).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_rivalries (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  opponent_kind  TEXT NOT NULL,
  opponent_id    TEXT NOT NULL,
  opponent_name  TEXT NOT NULL,
  hands_vs       INTEGER NOT NULL DEFAULT 0,
  chips_net      BIGINT  NOT NULL DEFAULT 0,
  hands_lost_to  INTEGER NOT NULL DEFAULT 0,
  hands_won_vs   INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, opponent_kind, opponent_id),
  CONSTRAINT user_rivalries_opponent_kind CHECK (opponent_kind IN ('user', 'bot'))
);

-- chips_net ascending = worst rivalries first; that's exactly what
-- "find my rival" wants.
CREATE INDEX IF NOT EXISTS user_rivalries_user_chips_idx
  ON user_rivalries (user_id, chips_net ASC);

-- ---------------------------------------------------------------------------
-- 5. Stored procedure that records the human side of a hand in one round
--    trip. Wraps the existing record_human_hand work (user_play_stats
--    upsert + bounded user_hand_history insert + prune) AND the new sinks
--    (user_hand_archive insert, user_daily_activity upsert, users.elo
--    update). Rivalry rows are still updated by a separate application
--    call because the per-opponent fan-out is variable-width and easier
--    to do in JS than in plpgsql.
--
-- Returns the updated stats row and the user's new ELO so the caller can
-- detect tier crossings + push the new rating into the in-memory player
-- object without a follow-up read.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS record_human_hand_v2(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
  REAL, REAL, JSONB, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
);

CREATE FUNCTION record_human_hand_v2(
  p_user_id             UUID,
  p_table_id            TEXT,
  -- aggregate counter deltas (same shape as record_human_hand)
  p_hands_voluntary     INTEGER,
  p_hands_won           INTEGER,
  p_showdowns_seen      INTEGER,
  p_showdowns_won       INTEGER,
  p_bluff_wins          INTEGER,
  p_preflop_opens       INTEGER,
  p_preflop_three_bets  INTEGER,
  p_preflop_calls       INTEGER,
  p_postflop_bets       INTEGER,
  p_postflop_raises     INTEGER,
  p_postflop_calls      INTEGER,
  p_c_bets_attempted    INTEGER,
  p_c_bets_won          INTEGER,
  p_chips_delta         INTEGER,
  p_big_blinds_played   INTEGER,
  p_open_size_bb        REAL,
  p_performance_score   REAL,
  p_compressed          JSONB,
  p_history_limit       INTEGER,
  -- new sinks
  p_elo_delta           INTEGER,
  p_won                 BOOLEAN,
  p_went_to_showdown    BOOLEAN,
  p_voluntarily_in      BOOLEAN,
  p_folded_preflop      BOOLEAN
) RETURNS TABLE (
  user_id              UUID,
  hands_seated         INTEGER,
  hands_voluntary      INTEGER,
  hands_won            INTEGER,
  showdowns_seen       INTEGER,
  showdowns_won        INTEGER,
  bluff_wins           INTEGER,
  preflop_opens        INTEGER,
  preflop_three_bets   INTEGER,
  preflop_calls        INTEGER,
  postflop_bets        INTEGER,
  postflop_raises      INTEGER,
  postflop_calls       INTEGER,
  c_bets_attempted     INTEGER,
  c_bets_won           INTEGER,
  chips_won_total      BIGINT,
  big_blinds_played    INTEGER,
  total_open_size_bb   REAL,
  performance_sum      REAL,
  performance_count    INTEGER,
  bot_unlocked_at      TIMESTAMPTZ,
  bot_built_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  new_elo              INTEGER,
  archive_id           BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_stats     user_play_stats;
  v_elo_before INTEGER;
  v_elo_after  INTEGER;
  v_now        TIMESTAMPTZ := NOW();
  v_day        DATE := (v_now AT TIME ZONE 'UTC')::date;
  v_archive_id BIGINT;
BEGIN
  -- Stats upsert (same body as record_human_hand).
  INSERT INTO user_play_stats (
    user_id, hands_seated, hands_voluntary, hands_won,
    showdowns_seen, showdowns_won, bluff_wins,
    preflop_opens, preflop_three_bets, preflop_calls,
    postflop_bets, postflop_raises, postflop_calls,
    c_bets_attempted, c_bets_won,
    chips_won_total, big_blinds_played, total_open_size_bb,
    performance_sum, performance_count, updated_at
  ) VALUES (
    p_user_id, 1, p_hands_voluntary, p_hands_won,
    p_showdowns_seen, p_showdowns_won, p_bluff_wins,
    p_preflop_opens, p_preflop_three_bets, p_preflop_calls,
    p_postflop_bets, p_postflop_raises, p_postflop_calls,
    p_c_bets_attempted, p_c_bets_won,
    p_chips_delta, p_big_blinds_played, p_open_size_bb,
    p_performance_score, 1, v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    hands_seated        = user_play_stats.hands_seated       + 1,
    hands_voluntary     = user_play_stats.hands_voluntary    + EXCLUDED.hands_voluntary,
    hands_won           = user_play_stats.hands_won          + EXCLUDED.hands_won,
    showdowns_seen      = user_play_stats.showdowns_seen     + EXCLUDED.showdowns_seen,
    showdowns_won       = user_play_stats.showdowns_won      + EXCLUDED.showdowns_won,
    bluff_wins          = user_play_stats.bluff_wins         + EXCLUDED.bluff_wins,
    preflop_opens       = user_play_stats.preflop_opens      + EXCLUDED.preflop_opens,
    preflop_three_bets  = user_play_stats.preflop_three_bets + EXCLUDED.preflop_three_bets,
    preflop_calls       = user_play_stats.preflop_calls      + EXCLUDED.preflop_calls,
    postflop_bets       = user_play_stats.postflop_bets      + EXCLUDED.postflop_bets,
    postflop_raises     = user_play_stats.postflop_raises    + EXCLUDED.postflop_raises,
    postflop_calls      = user_play_stats.postflop_calls     + EXCLUDED.postflop_calls,
    c_bets_attempted    = user_play_stats.c_bets_attempted   + EXCLUDED.c_bets_attempted,
    c_bets_won          = user_play_stats.c_bets_won         + EXCLUDED.c_bets_won,
    chips_won_total     = user_play_stats.chips_won_total    + EXCLUDED.chips_won_total,
    big_blinds_played   = user_play_stats.big_blinds_played  + EXCLUDED.big_blinds_played,
    total_open_size_bb  = user_play_stats.total_open_size_bb + EXCLUDED.total_open_size_bb,
    performance_sum     = user_play_stats.performance_sum    + EXCLUDED.performance_sum,
    performance_count   = user_play_stats.performance_count  + 1,
    updated_at          = v_now
  RETURNING * INTO v_stats;

  -- Rolling 100-hand cache used by the clone-bot generator.
  INSERT INTO user_hand_history (user_id, data, played_at)
  VALUES (p_user_id, p_compressed, v_now);

  DELETE FROM user_hand_history
   WHERE id IN (
     SELECT id FROM user_hand_history
      WHERE user_id = p_user_id
      ORDER BY played_at DESC
      OFFSET p_history_limit
   );

  -- ELO + lifetime counters on the user row. GREATEST(300, ...) is the
  -- floor; we don't ceiling — strong players can climb arbitrarily.
  -- Read the current rating first (FOR UPDATE locks the row) so we can
  -- record both the pre- and post-floor values on the archive row.
  -- Reconstructing v_elo_before from the post-update value would be
  -- wrong when the floor kicks in (e.g. 305 - 10 → clamp to 300).
  SELECT elo INTO v_elo_before FROM users WHERE id = p_user_id FOR UPDATE;

  UPDATE users
     SET elo             = GREATEST(300, elo + p_elo_delta),
         hands_played    = hands_played + 1,
         hands_won       = hands_won + (CASE WHEN p_won THEN 1 ELSE 0 END),
         chips_won_total = chips_won_total + p_chips_delta,
         updated_at      = v_now
   WHERE id = p_user_id
   RETURNING elo INTO v_elo_after;

  -- Unbounded archive — replays + export read from here. elo_delta stores
  -- the *applied* change (after the 300-floor clamp) so a sum over the
  -- archive reconstructs the player's rating exactly.
  INSERT INTO user_hand_archive (
    user_id, table_id, played_at,
    chips_delta, won, went_to_showdown, voluntarily_in, folded_preflop,
    elo_before, elo_after, elo_delta, data
  ) VALUES (
    p_user_id, p_table_id, v_now,
    p_chips_delta, p_won, p_went_to_showdown, p_voluntarily_in, p_folded_preflop,
    v_elo_before, v_elo_after, v_elo_after - v_elo_before, p_compressed
  )
  RETURNING id INTO v_archive_id;

  -- Per-day rollup. First hand of the day sets elo_start; every hand bumps
  -- elo_end, counters, and last_hand_at.
  INSERT INTO user_daily_activity (
    user_id, day, hands_played, hands_won, chips_delta,
    elo_start, elo_end, first_hand_at, last_hand_at
  ) VALUES (
    p_user_id, v_day, 1,
    CASE WHEN p_won THEN 1 ELSE 0 END,
    p_chips_delta,
    v_elo_before, v_elo_after, v_now, v_now
  )
  ON CONFLICT (user_id, day) DO UPDATE SET
    hands_played  = user_daily_activity.hands_played + 1,
    hands_won     = user_daily_activity.hands_won + EXCLUDED.hands_won,
    chips_delta   = user_daily_activity.chips_delta + EXCLUDED.chips_delta,
    elo_end       = EXCLUDED.elo_end,
    last_hand_at  = EXCLUDED.last_hand_at;

  RETURN QUERY SELECT
    v_stats.user_id,
    v_stats.hands_seated,
    v_stats.hands_voluntary,
    v_stats.hands_won,
    v_stats.showdowns_seen,
    v_stats.showdowns_won,
    v_stats.bluff_wins,
    v_stats.preflop_opens,
    v_stats.preflop_three_bets,
    v_stats.preflop_calls,
    v_stats.postflop_bets,
    v_stats.postflop_raises,
    v_stats.postflop_calls,
    v_stats.c_bets_attempted,
    v_stats.c_bets_won,
    v_stats.chips_won_total,
    v_stats.big_blinds_played,
    v_stats.total_open_size_bb,
    v_stats.performance_sum,
    v_stats.performance_count,
    v_stats.bot_unlocked_at,
    v_stats.bot_built_at,
    v_stats.updated_at,
    v_elo_after,
    v_archive_id;
END;
$$;
