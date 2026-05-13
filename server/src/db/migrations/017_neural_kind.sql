-- Variant tag for neural bots: existing α/β are 'reinforce' (the original
-- vanilla policy-gradient). The new γ/δ/ε bots use different learning
-- techniques — kind decides which policy module the runtime calls.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS neural_kind TEXT;

-- Backfill existing NN bots to 'reinforce' so the registry dispatch has
-- something to look at without a defensive default everywhere.
UPDATE bots SET neural_kind = 'reinforce'
 WHERE is_neural = TRUE AND neural_kind IS NULL;
