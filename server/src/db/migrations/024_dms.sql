-- Direct messages between two users. Conversations live in a separate
-- table keyed by a CANONICAL pair (user_a_id < user_b_id) so every pair
-- has exactly one conversation row regardless of who sent first. That
-- lets the inbox query "all conversations for user X" hit a single index
-- without a self-JOIN.

CREATE TABLE IF NOT EXISTS dm_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Canonical-pair check: enforce user_a < user_b lexicographically so
  -- there's never two rows for the same pair.
  CONSTRAINT dm_conversations_canonical_pair CHECK (user_a_id < user_b_id),
  CONSTRAINT dm_conversations_pair_unique    UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS dm_conversations_user_a_recent_idx
  ON dm_conversations (user_a_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS dm_conversations_user_b_recent_idx
  ON dm_conversations (user_b_id, last_message_at DESC NULLS LAST);

-- Messages within a conversation. Read tracking is per-recipient via the
-- `read_at` column (NULL = unread by the OTHER party). The sender's view
-- never needs read_at — they've "read" everything they sent.
CREATE TABLE IF NOT EXISTS dm_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES dm_conversations (id) ON DELETE CASCADE,
  sender_user_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Free-text body. Max 4 KB so a single message can't blow the WS
  -- broadcast budget. Hard cap enforced app-side too.
  body            TEXT NOT NULL,
  -- Lightweight discriminator for special message types. NULL = regular
  -- chat. 'table_invite' is what gets used by the "invite to table"
  -- feature; the metadata column carries the tableId etc.
  kind            TEXT,
  metadata        JSONB,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dm_messages_conv_recent_idx
  ON dm_messages (conversation_id, created_at DESC);
-- Partial index for the unread-by-recipient count, which the DMs button
-- in the nav polls. We don't store recipient_id directly (it's derived
-- from conversation + sender) so the unread filter is just "read_at IS
-- NULL"; the recipient join lives in the read path.
CREATE INDEX IF NOT EXISTS dm_messages_unread_idx
  ON dm_messages (conversation_id) WHERE read_at IS NULL;
