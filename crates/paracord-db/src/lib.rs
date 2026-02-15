pub mod attachments;
pub mod audit_log;
pub mod bans;
pub mod bot_applications;
pub mod channel_overwrites;
pub mod channels;
pub mod dms;
pub mod emojis;
pub mod federation;
pub mod guilds;
pub mod invites;
pub mod members;
pub mod messages;
pub mod polls;
pub mod prekeys;
pub mod rate_limits;
pub mod reactions;
pub mod read_states;
pub mod relationships;
pub mod roles;
pub mod scheduled_events;
pub mod security_events;
pub mod server_settings;
pub mod sessions;
pub mod users;
pub mod voice_states;
pub mod webhooks;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::str::FromStr;
use thiserror::Error;

pub type DbPool = sqlx::SqlitePool;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("not found")]
    NotFound,
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<DbPool, sqlx::Error> {
    create_pool_with_sqlite_key(database_url, max_connections, None).await
}

pub async fn create_pool_with_sqlite_key(
    database_url: &str,
    max_connections: u32,
    sqlite_key_hex: Option<String>,
) -> Result<DbPool, sqlx::Error> {
    let sqlite_key_hex = sqlite_key_hex.filter(|k| !k.trim().is_empty());
    if let Some(key_hex) = &sqlite_key_hex {
        let valid_len = key_hex.len() == 64;
        let valid_hex = key_hex.chars().all(|ch| ch.is_ascii_hexdigit());
        if !valid_len || !valid_hex {
            return Err(sqlx::Error::Protocol(
                "invalid sqlite key format (expected 64 hex chars)".to_string(),
            ));
        }
    }

    let options = SqliteConnectOptions::from_str(database_url)?
        .journal_mode(SqliteJournalMode::Wal)
        .create_if_missing(true)
        .foreign_keys(true);

    let after_connect_key = sqlite_key_hex.clone();
    SqlitePoolOptions::new()
        .max_connections(max_connections)
        .after_connect(move |conn, _meta| {
            let sqlite_key_hex = after_connect_key.clone();
            Box::pin(async move {
                if let Some(key_hex) = sqlite_key_hex {
                    let pragma = format!("PRAGMA key = \"x'{}'\";", key_hex);
                    sqlx::query(&pragma).execute(&mut *conn).await?;

                    let cipher_version: Option<String> =
                        sqlx::query_scalar("PRAGMA cipher_version;")
                            .fetch_optional(&mut *conn)
                            .await?;
                    let has_cipher = cipher_version
                        .as_deref()
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .is_some();
                    if !has_cipher {
                        return Err(sqlx::Error::Protocol(
                            "sqlite encryption requested, but SQLCipher support is unavailable"
                                .to_string(),
                        ));
                    }
                }
                Ok(())
            })
        })
        .connect_with(options)
        .await
}

pub async fn run_migrations(pool: &DbPool) -> Result<(), sqlx::Error> {
    sqlx::migrate!("./migrations").run(pool).await?;
    backfill_webhook_token_hashes(pool).await?;
    tracing::info!("migrations: applied successfully");
    Ok(())
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

async fn backfill_webhook_token_hashes(pool: &DbPool) -> Result<(), sqlx::Error> {
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, token FROM webhooks")
        .fetch_all(pool)
        .await?;

    for (id, token) in rows {
        let trimmed = token.trim();
        if trimmed.is_empty() || is_hex_sha256(trimmed) {
            continue;
        }
        let hashed = sha256_hex(trimmed);
        sqlx::query("UPDATE webhooks SET token = ?2 WHERE id = ?1")
            .bind(id)
            .bind(hashed)
            .execute(pool)
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        backfill_webhook_token_hashes, create_pool, create_pool_with_sqlite_key, run_migrations,
    };

    #[tokio::test]
    async fn create_pool_supports_default_sqlite_mode() {
        let pool = create_pool("sqlite::memory:", 1).await.expect("pool");
        let value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&pool)
            .await
            .expect("query");
        assert_eq!(value, 1);
    }

    #[tokio::test]
    async fn rejects_invalid_sqlite_key_format() {
        let err = create_pool_with_sqlite_key("sqlite::memory:", 1, Some("abc".to_string()))
            .await
            .expect_err("invalid key must fail");
        assert!(matches!(err, sqlx::Error::Protocol(_)));
    }

    #[tokio::test]
    async fn webhook_token_backfill_hashes_plaintext_tokens() {
        let pool = create_pool("sqlite::memory:", 1).await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        sqlx::query(
            "INSERT INTO users (id, username, discriminator, email, password_hash)
             VALUES (1, 'u', 1, 'u@example.com', 'hash')",
        )
        .execute(&pool)
        .await
        .expect("insert user");
        sqlx::query(
            "INSERT INTO spaces (id, name, owner_id)
             VALUES (2, 'space', 1)",
        )
        .execute(&pool)
        .await
        .expect("insert space");
        sqlx::query(
            "INSERT INTO channels (id, space_id, name, channel_type, position)
             VALUES (3, 2, 'general', 0, 0)",
        )
        .execute(&pool)
        .await
        .expect("insert channel");
        sqlx::query(
            "INSERT INTO webhooks (id, space_id, channel_id, creator_id, name, token)
             VALUES (4, 2, 3, 1, 'hook', 'plaintext-token')",
        )
        .execute(&pool)
        .await
        .expect("insert webhook");

        backfill_webhook_token_hashes(&pool)
            .await
            .expect("backfill webhook hashes");

        let stored: String = sqlx::query_scalar("SELECT token FROM webhooks WHERE id = 4")
            .fetch_one(&pool)
            .await
            .expect("load webhook");
        assert_eq!(stored.len(), 64);
        assert_ne!(stored, "plaintext-token");
    }
}
