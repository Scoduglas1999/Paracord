CREATE TABLE IF NOT EXISTS federation_file_cache (
    id                   BIGSERIAL PRIMARY KEY,
    origin_server        TEXT NOT NULL,
    origin_attachment_id TEXT NOT NULL,
    content_hash         TEXT NOT NULL,
    filename             TEXT NOT NULL,
    content_type         TEXT,
    size                 BIGINT NOT NULL,
    storage_key          TEXT NOT NULL,
    cached_at            TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at           TEXT,
    last_accessed_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(origin_server, origin_attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_fed_file_cache_expires ON federation_file_cache (expires_at);
