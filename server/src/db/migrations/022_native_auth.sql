-- Native email + password auth alongside Google OAuth. A single users row
-- can be linked to either or both — google_sub stays nullable, the new
-- password_hash column is nullable too. The user's primary identifier is
-- still `id` (UUID); `username` is a public handle separate from the
-- mutable display_name so other users can @-mention by a stable string.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

-- google_sub was NOT NULL UNIQUE; relax so native-auth users can be
-- inserted without a google identity. Still unique when present so the
-- OAuth-link path is collision-safe.
ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;

-- Usernames are public handles. Unique (case-insensitive via lower())
-- with a 24-char cap; lowercase plus digits + underscore.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL;

-- Email already exists (NOT NULL). Make it case-insensitive unique so
-- you can't sign up twice with FOO@x and foo@x. Skip if there's already
-- an index covering it.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (LOWER(email));

-- ---------------------------------------------------------------------------
-- Email-verification codes. One row per (user, purpose, code-issued-at).
-- Codes expire after EMAIL_CODE_TTL_MINUTES (5 by default in code).
-- `consumed_at` lets us retire codes without deleting the audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'signup' verifies the account; 'reset' authorizes a password change.
  purpose      TEXT NOT NULL CHECK (purpose IN ('signup', 'reset')),
  -- 6-digit code stored as text. The server compares constant-time;
  -- no hashing because the value is short-lived (5 min) and single-use.
  code         TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active-codes-by-user lookup. Filtered on the hot predicate so the
-- index stays narrow even after lots of historical rows accumulate.
CREATE INDEX IF NOT EXISTS email_verifications_user_active_idx
  ON email_verifications (user_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;
