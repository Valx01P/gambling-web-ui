-- Performance pass: 1-RTT stored procedures for the hand-recording hot path,
-- a partial covering index for the public leaderboard, and a UNIQUE on
-- users.email. Non-destructive — existing data stays put.
--
-- After this migration the application calls `SELECT record_bot_hand(...)`
-- and `SELECT record_human_hand(...)` instead of running per-write
-- transactions, cutting 4–5 round-trips per hand down to 1.

-- ---------------------------------------------------------------------------
-- 1. Tighten users.email — it should always have been unique. Guarded so a
--    re-run is a no-op even if the constraint was already added by hand.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
  ) THEN
    -- Drop the non-unique index first; the unique constraint creates its own.
    DROP INDEX IF EXISTS users_email_idx;
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Leaderboard index. The existing bots_public_non_clone_idx puts
--    is_public/is_clone before elo, which forces PG to walk every public
--    bot to satisfy the ORDER BY elo DESC. A partial index keyed on
--    (elo DESC, created_at DESC) lets the planner stream rows directly
--    and stop at LIMIT.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bots_public_leaderboard_idx
  ON bots (elo DESC, created_at DESC)
  WHERE is_public = TRUE AND is_clone = FALSE;

-- ---------------------------------------------------------------------------
-- 3. Audit log retention helper. We don't partition (would require a
--    bigger rebuild) but we add an index that lets a future cleanup job
--    drop old rows in O(log n) — `DELETE WHERE played_at < NOW() - '90 days'`.
--    Existing `bot_hand_results_bot_idx` is (bot_id, played_at DESC) which
--    doesn't help that scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bot_hand_results_played_at_idx
  ON bot_hand_results (played_at);

-- ---------------------------------------------------------------------------
-- 4. Hot-path stored procedure: record one bot's per-hand outcome.
--    Inserts the audit row + updates the aggregate counters on `bots`
--    inside a single statement, so the application gets BEGIN/COMMIT
--    semantics without spending the round-trips on them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_bot_hand(
  p_bot_id            UUID,
  p_table_id          TEXT,
  p_chips_delta       INTEGER,
  p_went_to_showdown  BOOLEAN,
  p_won               BOOLEAN,
  p_folded_preflop    BOOLEAN,
  p_voluntarily_in    BOOLEAN,
  p_elo_change        INTEGER,
  p_bluff_win         BOOLEAN,
  p_preflop_score     REAL,
  p_performance_score REAL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO bot_hand_results (
    bot_id, table_id, chips_delta, went_to_showdown, won, folded_preflop,
    voluntarily_in, was_bluff_win, preflop_score, performance_score
  ) VALUES (
    p_bot_id, p_table_id, p_chips_delta, p_went_to_showdown, p_won, p_folded_preflop,
    p_voluntarily_in, p_bluff_win, p_preflop_score, p_performance_score
  );

  UPDATE bots
     SET hands_played     = hands_played     + 1,
         hands_voluntary  = hands_voluntary  + CASE WHEN p_voluntarily_in THEN 1 ELSE 0 END,
         hands_won        = hands_won        + CASE WHEN p_won THEN 1 ELSE 0 END,
         showdowns_played = showdowns_played + CASE WHEN p_went_to_showdown THEN 1 ELSE 0 END,
         showdowns_won    = showdowns_won    + CASE WHEN p_went_to_showdown AND p_won THEN 1 ELSE 0 END,
         bluff_wins       = bluff_wins       + CASE WHEN p_bluff_win THEN 1 ELSE 0 END,
         chips_won_total  = chips_won_total  + p_chips_delta,
         elo              = GREATEST(300, elo + p_elo_change),
         updated_at       = NOW()
   WHERE id = p_bot_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hot-path stored procedure: record one user's per-hand outcome.
--    Combines the upsert into user_play_stats, insert into user_hand_history,
--    and the rolling-100 prune into a single SQL call. Returns the new stats
--    row so the application can detect tier-crossing without a follow-up
--    SELECT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_human_hand(
  p_user_id             UUID,
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
  p_history_limit       INTEGER
) RETURNS user_play_stats
LANGUAGE plpgsql
AS $$
DECLARE
  v_stats user_play_stats;
BEGIN
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
    p_performance_score, 1, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    hands_seated       = user_play_stats.hands_seated      + 1,
    hands_voluntary    = user_play_stats.hands_voluntary   + EXCLUDED.hands_voluntary,
    hands_won          = user_play_stats.hands_won         + EXCLUDED.hands_won,
    showdowns_seen     = user_play_stats.showdowns_seen    + EXCLUDED.showdowns_seen,
    showdowns_won      = user_play_stats.showdowns_won     + EXCLUDED.showdowns_won,
    bluff_wins         = user_play_stats.bluff_wins        + EXCLUDED.bluff_wins,
    preflop_opens      = user_play_stats.preflop_opens     + EXCLUDED.preflop_opens,
    preflop_three_bets = user_play_stats.preflop_three_bets + EXCLUDED.preflop_three_bets,
    preflop_calls      = user_play_stats.preflop_calls     + EXCLUDED.preflop_calls,
    postflop_bets      = user_play_stats.postflop_bets     + EXCLUDED.postflop_bets,
    postflop_raises    = user_play_stats.postflop_raises   + EXCLUDED.postflop_raises,
    postflop_calls     = user_play_stats.postflop_calls    + EXCLUDED.postflop_calls,
    c_bets_attempted   = user_play_stats.c_bets_attempted  + EXCLUDED.c_bets_attempted,
    c_bets_won         = user_play_stats.c_bets_won        + EXCLUDED.c_bets_won,
    chips_won_total    = user_play_stats.chips_won_total   + EXCLUDED.chips_won_total,
    big_blinds_played  = user_play_stats.big_blinds_played + EXCLUDED.big_blinds_played,
    total_open_size_bb = user_play_stats.total_open_size_bb + EXCLUDED.total_open_size_bb,
    performance_sum    = user_play_stats.performance_sum   + EXCLUDED.performance_sum,
    performance_count  = user_play_stats.performance_count + 1,
    updated_at         = NOW()
  RETURNING * INTO v_stats;

  INSERT INTO user_hand_history (user_id, data) VALUES (p_user_id, p_compressed);

  -- Prune anything past the rolling window. Single statement, uses the
  -- (user_id, played_at DESC) index. p_history_limit comes from the
  -- application so we don't hard-code a magic number in two places.
  DELETE FROM user_hand_history
   WHERE id IN (
     SELECT id FROM user_hand_history
      WHERE user_id = p_user_id
      ORDER BY played_at DESC
      OFFSET p_history_limit
   );

  RETURN v_stats;
END;
$$;
