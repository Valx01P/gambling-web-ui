-- Persistent learning state for super bots. The same column shape no
-- matter which transition mode the bot uses — uniform / weighted /
-- thompson / markov — so the BotPlayer can swap algorithms without a
-- schema migration. Old super bots created before this migration just
-- get a null state and the runtime falls back to uniform sampling.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS super_state JSONB;
