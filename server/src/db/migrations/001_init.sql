-- Users authenticated via Google OAuth.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub      TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Poker bots authored by users. `rules` is the DSL document; `phrases` is
-- a map of event -> string[] that the runtime samples from for chat.
CREATE TABLE IF NOT EXISTS bots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  color               TEXT NOT NULL DEFAULT '#3b82f6',
  rules               JSONB NOT NULL DEFAULT '{"rules":[]}'::jsonb,
  phrases             JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public           BOOLEAN NOT NULL DEFAULT TRUE,
  elo                 INTEGER NOT NULL DEFAULT 1200,
  hands_played        INTEGER NOT NULL DEFAULT 0,
  hands_won           INTEGER NOT NULL DEFAULT 0,
  showdowns_played    INTEGER NOT NULL DEFAULT 0,
  showdowns_won       INTEGER NOT NULL DEFAULT 0,
  bluffs_attempted    INTEGER NOT NULL DEFAULT 0,
  bluffs_succeeded    INTEGER NOT NULL DEFAULT 0,
  chips_won_total     BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bots_name_length CHECK (char_length(name) BETWEEN 1 AND 32),
  CONSTRAINT bots_color_format CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE INDEX IF NOT EXISTS bots_owner_idx ON bots (owner_user_id);
CREATE INDEX IF NOT EXISTS bots_public_elo_idx ON bots (is_public, elo DESC);

-- Per-hand audit trail used by the ELO recompute job and the bot's stats card.
CREATE TABLE IF NOT EXISTS bot_hand_results (
  id                BIGSERIAL PRIMARY KEY,
  bot_id            UUID NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  table_id          TEXT NOT NULL,
  chips_delta       INTEGER NOT NULL,
  went_to_showdown  BOOLEAN NOT NULL DEFAULT FALSE,
  won               BOOLEAN NOT NULL DEFAULT FALSE,
  folded_preflop    BOOLEAN NOT NULL DEFAULT FALSE,
  voluntarily_in    BOOLEAN NOT NULL DEFAULT FALSE,
  played_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_hand_results_bot_idx ON bot_hand_results (bot_id, played_at DESC);
