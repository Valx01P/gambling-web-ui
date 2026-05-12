-- Bump bots.code length cap from 32 KB to 128 KB so the DB constraint matches
-- the app-side validator (MAX_CODE_LENGTH in ruleSchema.js). The starter bot
-- template outgrew the old 32 KB limit, which surfaced as a 500 on every save.
ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_code_length;
ALTER TABLE bots ADD CONSTRAINT bots_code_length CHECK (char_length(code) <= 131072);
