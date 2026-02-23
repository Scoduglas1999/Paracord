-- Application commands (slash commands, user commands, message commands).
CREATE TABLE IF NOT EXISTS application_commands (
    id              BIGINT PRIMARY KEY,
    application_id  BIGINT NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
    guild_id        BIGINT REFERENCES spaces(id) ON DELETE CASCADE,
    name            VARCHAR(32) NOT NULL,
    description     VARCHAR(100) NOT NULL,
    options         TEXT,
    type            SMALLINT NOT NULL DEFAULT 1,
    default_member_permissions BIGINT,
    dm_permission   BOOLEAN NOT NULL DEFAULT TRUE,
    nsfw            BOOLEAN NOT NULL DEFAULT FALSE,
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(application_id, guild_id, name, type)
);
CREATE INDEX IF NOT EXISTS idx_application_commands_app ON application_commands(application_id);
CREATE INDEX IF NOT EXISTS idx_application_commands_guild ON application_commands(guild_id);

-- Interaction tokens for deferred / follow-up responses.
CREATE TABLE IF NOT EXISTS interaction_tokens (
    id              BIGINT PRIMARY KEY,
    interaction_id  BIGINT NOT NULL UNIQUE,
    application_id  BIGINT NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
    token_hash      VARCHAR(128) NOT NULL,
    channel_id      BIGINT NOT NULL,
    guild_id        BIGINT,
    user_id         BIGINT NOT NULL,
    type            SMALLINT NOT NULL,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interaction_tokens_app ON interaction_tokens(application_id);
CREATE INDEX IF NOT EXISTS idx_interaction_tokens_expires ON interaction_tokens(expires_at);
