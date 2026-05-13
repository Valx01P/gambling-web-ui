-- Free-text user bio surfaced on the profile modal. Plain TEXT (not
-- VARCHAR) — the column length check happens app-side so we can change
-- the cap later without a migration. Nullable; old users see an empty
-- bio until they fill one in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS description TEXT;
