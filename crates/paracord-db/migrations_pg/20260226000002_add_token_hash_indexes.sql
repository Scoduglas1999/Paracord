CREATE INDEX IF NOT EXISTS idx_interaction_tokens_hash ON interaction_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_bot_applications_token_hash ON bot_applications(token_hash);
