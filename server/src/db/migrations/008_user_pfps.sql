-- User-uploaded profile images. One row per saved image; the user can
-- pick any of them at any point as their "current" avatar (referenced
-- through users.avatar_url). Deleting a row triggers an S3 cleanup on
-- the application side — we don't cascade from the DB because the S3
-- object lives in a separate system and a failed delete shouldn't
-- abort the local transaction.
--
-- `s3_key` is the object key inside the upload bucket — the *only* place
-- that's authoritative. `public_url` is denormalized (CloudFront URL of
-- the same object) so that listing the user's history doesn't need to
-- recompose the URL on every request.

CREATE TABLE IF NOT EXISTS user_pfps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  s3_key          TEXT NOT NULL,
  public_url      TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ,
  CONSTRAINT user_pfps_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT user_pfps_content_type_image CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  )
);

-- Most queries are "list this user's PFPs newest-first" so this is the
-- exact shape we want.
CREATE INDEX IF NOT EXISTS user_pfps_user_idx
  ON user_pfps (user_id, created_at DESC);

-- Each s3_key is generated with a UUID so a hard duplicate is essentially
-- impossible, but the unique constraint is cheap insurance against a
-- bug that ever creates two rows pointing at the same object.
CREATE UNIQUE INDEX IF NOT EXISTS user_pfps_s3_key_uniq
  ON user_pfps (s3_key);
