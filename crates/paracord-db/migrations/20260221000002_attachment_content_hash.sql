ALTER TABLE attachments ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_attachments_upload_channel
    ON attachments (upload_channel_id) WHERE upload_channel_id IS NOT NULL;
