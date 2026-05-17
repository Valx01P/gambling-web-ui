-- Per-user felt color preference. Previously a client-only setting living
-- in localStorage; promoted to a DB column so it follows the user across
-- devices and applies to every page on the site (not just the poker
-- table). The id maps to the client-side TABLE_COLOR_PALETTES list plus
-- five user-defined custom slots (custom-0 … custom-4). Anonymous users
-- still rely on localStorage — only signed-in users hit this column.

-- 'emerald' is the original default; matches DEFAULT_TABLE_COLOR_ID on
-- the client. NULL means "user hasn't picked yet, use the default" — we
-- store NULL rather than 'emerald' so an upgrade path that ever moves
-- the default doesn't silently lock everyone to today's choice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS felt_color_id TEXT;

-- Up to 5 user-defined custom colors, each `{ hex: '#rrggbb', label: '…' }`.
-- Stored as JSONB so the client can write/read the same structure it
-- holds in memory. NULL when the user has no custom slots filled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS felt_custom_colors JSONB;
