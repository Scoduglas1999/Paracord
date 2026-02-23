CREATE TABLE IF NOT EXISTS user_xp (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id    BIGINT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    xp          BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    level       INTEGER NOT NULL DEFAULT 0,
    last_xp_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, guild_id)
);
