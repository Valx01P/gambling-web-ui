-- Bots can now have a custom uploaded avatar in addition to the existing
-- color + initials fallback. The URL lives on the bot row directly (one
-- avatar per bot, easy to update). The image itself is uploaded to S3 via
-- the same presign flow users use for their own PFPs — and only the owner
-- can update their own bot's avatar (enforced in botRoutes), so there's no
-- separate ownership table needed here.
--
-- Length cap matches user_pfps.public_url for consistency. Nullable: bots
-- created before this migration keep their initials-on-color avatar
-- automatically.

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE bots
  ADD CONSTRAINT bots_avatar_url_length
  CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 512);
