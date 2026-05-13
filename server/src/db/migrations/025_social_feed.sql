-- Lightweight social feed: posts + threaded comments + likes. Designed
-- to mirror the existing patterns (UUID PKs, JSONB metadata where it
-- matters, partial indexes for hot reads). Likes use a composite-PK
-- junction table so a "did I like this?" lookup is constant time and
-- the like_count stays denormalized for cheap render.

CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Body is plain text. We do NOT store HTML — the client renders mentions
  -- + URLs at display time so a malicious payload can't leak past the
  -- safe-text boundary even if a future client gets sloppy.
  body            TEXT NOT NULL DEFAULT '',
  -- Optional CloudFront URL to a single image uploaded via the existing
  -- S3 presigned-PUT pipeline. We deliberately allow only ONE image per
  -- post for v1 — keeps the composer simple and the feed cards uniform.
  image_url       TEXT,
  -- Optional reference to a poker room — set when the user shares a
  -- table from the action menu. The feed card renders this as a join
  -- button, similar to the table-invite DM bubble.
  table_id        TEXT,
  -- Denormalized counters. Bumped/decremented inside the like + comment
  -- handlers; cheaper than re-aggregating per render. Drift is bounded
  -- to single-digit per a recompute job if we ever bother.
  like_count      INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reverse-chrono feed query — newest non-deleted posts first.
CREATE INDEX IF NOT EXISTS posts_recent_idx
  ON posts (created_at DESC) WHERE deleted_at IS NULL;
-- Per-author timeline for the profile page.
CREATE INDEX IF NOT EXISTS posts_by_user_idx
  ON posts (user_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- One level of threading: top-level vs reply-to-a-comment. Lets the
  -- UI show a tiny "Reply" affordance under each comment without
  -- needing nested ltree gymnastics. NULL = top-level on the post.
  parent_comment_id UUID REFERENCES post_comments (id) ON DELETE CASCADE,
  body              TEXT NOT NULL DEFAULT '',
  like_count        INTEGER NOT NULL DEFAULT 0,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS post_comments_post_recent_idx
  ON post_comments (post_id, created_at ASC) WHERE deleted_at IS NULL;

-- Post likes — composite PK so re-liking is a no-op (ON CONFLICT) and
-- the "did I like this" join is a unique-index hit.
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);
-- "How many likes does this post have" already comes from posts.like_count
-- (denormalized). This index supports the rarer "show me the users who
-- liked this post" view.
CREATE INDEX IF NOT EXISTS post_likes_post_idx
  ON post_likes (post_id, created_at DESC);
