-- Per-user aggregate stats + a rolling 100-hand history. The bot generator
-- reads from both: stats give the long-term tendency knobs (VPIP, PFR,
-- aggression freq, c-bet rate, etc.), history gives the situational
-- patterns (what the user actually did from the BTN with a marginal hand,
-- sizing distributions, when they bluffed and won, etc.).
--
-- Privacy: this is the entire footprint we keep on a user's play. No hand
-- older than the 100 most recent is retained; older rows are pruned at
-- write time by the application layer.

CREATE TABLE IF NOT EXISTS user_play_stats (
  user_id              UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  hands_seated         INTEGER NOT NULL DEFAULT 0,
  hands_voluntary      INTEGER NOT NULL DEFAULT 0,
  hands_won            INTEGER NOT NULL DEFAULT 0,
  showdowns_seen       INTEGER NOT NULL DEFAULT 0,
  showdowns_won        INTEGER NOT NULL DEFAULT 0,
  bluff_wins           INTEGER NOT NULL DEFAULT 0,
  preflop_opens        INTEGER NOT NULL DEFAULT 0,
  preflop_three_bets   INTEGER NOT NULL DEFAULT 0,
  preflop_calls        INTEGER NOT NULL DEFAULT 0,
  postflop_bets        INTEGER NOT NULL DEFAULT 0,
  postflop_raises      INTEGER NOT NULL DEFAULT 0,
  postflop_calls       INTEGER NOT NULL DEFAULT 0,
  c_bets_attempted     INTEGER NOT NULL DEFAULT 0,
  c_bets_won           INTEGER NOT NULL DEFAULT 0,
  chips_won_total      BIGINT  NOT NULL DEFAULT 0,
  big_blinds_played    INTEGER NOT NULL DEFAULT 0,
  total_open_size_bb   REAL    NOT NULL DEFAULT 0,
  performance_sum      REAL    NOT NULL DEFAULT 0,   -- running sum of per-hand performanceScore
  performance_count    INTEGER NOT NULL DEFAULT 0,
  bot_unlocked_at      TIMESTAMPTZ,                  -- set when the 12-hand threshold is crossed
  bot_built_at         TIMESTAMPTZ,                  -- set when the user actually generates a bot
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compressed snapshot of a single hand from the user's perspective. Each
-- row is small (<1 KB) and the whole table is bounded by N_USERS * 100.
CREATE TABLE IF NOT EXISTS user_hand_history (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  played_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data        JSONB NOT NULL
);

-- Lookup pattern: "give me this user's most recent N hands". Supports the
-- pruning step that drops anything past the 100th newest row.
CREATE INDEX IF NOT EXISTS user_hand_history_user_played_idx
  ON user_hand_history (user_id, played_at DESC);
