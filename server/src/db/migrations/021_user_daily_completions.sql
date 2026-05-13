-- Per-day daily-challenge completion log. The users row only tracks the
-- *current* day's daily; once the date rolls over, yesterday's completion
-- is gone from the users record (overwritten by today's). This table
-- preserves a row for every day a user completed the daily so the profile
-- calendar can render historical "★ daily done" marks.
CREATE TABLE IF NOT EXISTS user_daily_completions (
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  daily_id     TEXT,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS user_daily_completions_user_day_idx
  ON user_daily_completions (user_id, day DESC);
