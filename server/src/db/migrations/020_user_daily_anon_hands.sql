-- Count hands a signed-in user played while NOT in "play as YOU" mode.
-- The existing hands_played column reflects only public-self play (the
-- only thing that lands in user_hand_archive). This column captures the
-- complement: hands played while logged-in but choosing to stay anon at
-- the table. Used by the profile calendar to tint days the user was
-- active in any mode, not just public.
ALTER TABLE user_daily_activity
  ADD COLUMN IF NOT EXISTS anon_hands INTEGER NOT NULL DEFAULT 0;
