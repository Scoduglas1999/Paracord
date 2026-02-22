CREATE TABLE IF NOT EXISTS guild_storage_policies (
    guild_id       BIGINT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
    max_file_size  BIGINT,
    storage_quota  BIGINT,
    retention_days INTEGER,
    allowed_types  TEXT,
    blocked_types  TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
