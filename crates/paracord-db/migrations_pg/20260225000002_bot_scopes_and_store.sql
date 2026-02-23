-- Add bot store metadata and scopes to bot_applications.
ALTER TABLE bot_applications ADD COLUMN scopes TEXT DEFAULT 'bot';
ALTER TABLE bot_applications ADD COLUMN intents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bot_applications ADD COLUMN public_listed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bot_applications ADD COLUMN category VARCHAR(50);
ALTER TABLE bot_applications ADD COLUMN tags TEXT;
ALTER TABLE bot_applications ADD COLUMN icon_hash VARCHAR(64);
ALTER TABLE bot_applications ADD COLUMN install_count INTEGER NOT NULL DEFAULT 0;

-- Add scopes to guild installs.
ALTER TABLE bot_guild_installs ADD COLUMN scopes TEXT DEFAULT 'bot';

-- Add message components column.
ALTER TABLE messages ADD COLUMN components TEXT;
