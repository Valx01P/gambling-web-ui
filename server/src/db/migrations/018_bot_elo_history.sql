-- Persist post-hand ELO on each bot_hand_results row so we can plot a
-- bot's rating curve on the edit page. Old rows pre-date this column;
-- they stay NULL and the chart endpoint filters them out. New hands
-- start populating immediately.
ALTER TABLE bot_hand_results ADD COLUMN IF NOT EXISTS elo_after INTEGER;

-- Replace the stored proc so it stores `elo_after` on every new hand.
-- Order is flipped from the previous version: UPDATE first so the
-- RETURNING clause feeds the INSERT — same single-statement-per-hand
-- guarantee, just one extra hop through a local variable.
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
DECLARE
  v_elo_after INTEGER;
BEGIN
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
   WHERE id = p_bot_id
   RETURNING elo INTO v_elo_after;

  INSERT INTO bot_hand_results (
    bot_id, table_id, chips_delta, went_to_showdown, won, folded_preflop,
    voluntarily_in, was_bluff_win, preflop_score, performance_score, elo_after
  ) VALUES (
    p_bot_id, p_table_id, p_chips_delta, p_went_to_showdown, p_won, p_folded_preflop,
    p_voluntarily_in, p_bluff_win, p_preflop_score, p_performance_score, v_elo_after
  );
END;
$$;

-- Index for the chart query: pull the most recent N hands per bot in
-- chronological order. The existing (bot_id, played_at DESC) index from
-- migration 001 already serves this — no new index needed.
