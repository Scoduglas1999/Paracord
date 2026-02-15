use crate::{DbError, DbPool};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EmojiRow {
    pub id: i64,
    pub guild_id: i64,
    pub name: String,
    pub creator_id: Option<i64>,
    pub animated: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn create_emoji(
    pool: &DbPool,
    id: i64,
    guild_id: i64,
    name: &str,
    creator_id: i64,
    animated: bool,
) -> Result<EmojiRow, DbError> {
    let row = sqlx::query_as::<_, EmojiRow>(
        "INSERT INTO emojis (id, space_id, name, creator_id, animated)
         VALUES (?1, ?2, ?3, ?4, ?5)
         RETURNING id, space_id AS guild_id, name, creator_id, animated, created_at",
    )
    .bind(id)
    .bind(guild_id)
    .bind(name)
    .bind(creator_id)
    .bind(animated)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn get_emoji(pool: &DbPool, id: i64) -> Result<Option<EmojiRow>, DbError> {
    let row = sqlx::query_as::<_, EmojiRow>(
        "SELECT id, space_id AS guild_id, name, creator_id, animated, created_at
         FROM emojis WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn get_guild_emojis(pool: &DbPool, guild_id: i64) -> Result<Vec<EmojiRow>, DbError> {
    let rows = sqlx::query_as::<_, EmojiRow>(
        "SELECT id, space_id AS guild_id, name, creator_id, animated, created_at
         FROM emojis WHERE space_id = ?1 ORDER BY name",
    )
    .bind(guild_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_emoji(pool: &DbPool, id: i64, name: &str) -> Result<EmojiRow, DbError> {
    let row = sqlx::query_as::<_, EmojiRow>(
        "UPDATE emojis SET name = ?2
         WHERE id = ?1
         RETURNING id, space_id AS guild_id, name, creator_id, animated, created_at",
    )
    .bind(id)
    .bind(name)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn delete_emoji(pool: &DbPool, id: i64) -> Result<(), DbError> {
    sqlx::query("DELETE FROM emojis WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
