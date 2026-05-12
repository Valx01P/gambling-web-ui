-- Social layer — follow graph + presence timestamp.
--
-- A user can follow another user; the relationship is one-directional
-- (mutual following = two rows). Privacy: only signed-in users with
-- "Play as YOU" enabled appear at the table under their account, so the
-- discovery surface (clicking a seat) only ever exposes a userId the
-- seat's owner has opted into showing. Follows themselves are 1:1
-- between accounts and don't expose anything beyond what the public
-- profile slice already returns.
--
-- last_active_at gives us Discord-style "online recently" indicators
-- alongside the in-memory presence registry. The DB value is the
-- durable fallback when a user isn't currently WS-connected.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Backfill so existing accounts don't display "never seen" — `updated_at`
-- on the user row is a fair lower bound for "last time they did something".
UPDATE users SET last_active_at = COALESCE(last_active_at, updated_at);

-- Followers / following. PK on (follower, following) prevents duplicates
-- naturally; the reverse index makes "who follows X" cheap. Self-follows
-- are blocked at the application layer to keep the constraint simple
-- (CHECK on different columns is awkward to compose with the PK).
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- "Who follows X" path. PK already covers "who does X follow".
CREATE INDEX IF NOT EXISTS user_follows_following_idx
  ON user_follows (following_id, created_at DESC);

-- Bump last_active_at as part of record_human_hand_v2 so a recorded hand
-- also counts as activity. CREATE OR REPLACE — we keep the same
-- signature so the application doesn't need to change its call shape.
-- Body is identical to migration 010 except for the UPDATE on `users`
-- which now also touches `last_active_at`.
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

  -- Lock the user row, then update both ELO and last_active_at in one
  -- write. last_active_at = NOW() makes recorded hands count as activity
  -- for the social presence indicator.
  SELECT elo INTO v_elo_before FROM users WHERE id = p_user_id FOR UPDATE;

  UPDATE users
     SET elo             = GREATEST(300, elo + p_elo_delta),
         hands_played    = hands_played + 1,
         hands_won       = hands_won + (CASE WHEN p_won THEN 1 ELSE 0 END),
         chips_won_total = chips_won_total + p_chips_delta,
         last_active_at  = v_now,
         updated_at      = v_now
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
