-- Stop accumulating lifetime net chips on the user row. ELO is the
-- canonical performance signal — the redundant chips_won_total counter
-- adds nothing the per-hand archive can't recompute, and surfacing it
-- at the profile level was visually noisy (a profitable session early
-- on dominated the headline even after the player's ELO had moved).
--
-- We CREATE OR REPLACE the SP without the chips_won_total += chips_delta
-- update. The column itself is left in place (cheap, and a future
-- ALTER ... DROP COLUMN is reversible only via backup), so this is a
-- pure write-side change.

CREATE OR REPLACE FUNCTION record_human_hand_v2(
  p_user_id             UUID,
  p_table_id            TEXT,
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

  INSERT INTO user_hand_history (user_id, data, played_at)
  VALUES (p_user_id, p_compressed, v_now);

  DELETE FROM user_hand_history
   WHERE id IN (
     SELECT id FROM user_hand_history
      WHERE user_id = p_user_id
      ORDER BY played_at DESC
      OFFSET p_history_limit
   );

  SELECT elo INTO v_elo_before FROM users WHERE id = p_user_id FOR UPDATE;

  -- Note: chips_won_total intentionally NOT updated here. The lifetime
  -- net P/L is no longer surfaced anywhere — ELO is the player's
  -- canonical performance signal.
  UPDATE users
     SET elo            = GREATEST(300, elo + p_elo_delta),
         hands_played   = hands_played + 1,
         hands_won      = hands_won + (CASE WHEN p_won THEN 1 ELSE 0 END),
         last_active_at = v_now,
         updated_at     = v_now
   WHERE id = p_user_id
   RETURNING elo INTO v_elo_after;

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
