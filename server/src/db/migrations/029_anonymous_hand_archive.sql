-- Anonymous hand archiving.
--
-- Before this migration, hands played anonymously (signed-in user but
-- "Play as YOU" off) hit `recordAnonHand` only — bumping the daily
-- anon_hands counter, never archived. Result: the user couldn't see
-- their own anon hands on the calendar's day-drill, only a number.
--
-- Now `user_hand_archive` carries an is_anonymous flag. The recording
-- path archives both modes; reads filter on viewer identity:
--   - self viewing self → all rows (anon badge in the UI)
--   - anyone else → WHERE is_anonymous = FALSE
--
-- The default FALSE keeps existing archive rows truthful (they were all
-- public plays at write time). The partial index on (user_id, played_day)
-- WHERE is_anonymous = FALSE is what the public-profile day query reads,
-- letting it skip the anon rows without scanning the full per-day band.

ALTER TABLE user_hand_archive
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS user_hand_archive_user_day_public_idx
  ON user_hand_archive (user_id, played_day)
  WHERE is_anonymous = FALSE;
