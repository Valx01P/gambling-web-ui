-- App-wide notifications inbox. One row per delivered notification.
-- `kind` is the discriminator (mention / comment_reply / follow / dm /
-- table_invite / etc.); `payload` is a JSONB blob with whatever the
-- kind needs to render its card. `sender_user_id` is denormalized for
-- the common "who's it from" lookup; nullable for system notifications.
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sender_user_id  UUID REFERENCES users (id) ON DELETE SET NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recent-list query for the bell dropdown.
CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON notifications (user_id, created_at DESC);

-- Partial index for the cheap unread-count query that hits on every
-- nav-bell render.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id) WHERE read_at IS NULL;
