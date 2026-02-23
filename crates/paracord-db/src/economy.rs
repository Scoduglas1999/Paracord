use crate::{datetime_from_db_text, datetime_to_db_text, DbError, DbPool};
use chrono::{DateTime, Utc};
use sqlx::Row;

#[derive(Debug, Clone)]
pub struct UserXpRow {
    pub user_id: i64,
    pub guild_id: i64,
    pub xp: i64,
    pub level: i32,
    pub last_xp_at: DateTime<Utc>,
}

impl<'r> sqlx::FromRow<'r, sqlx::any::AnyRow> for UserXpRow {
    fn from_row(row: &'r sqlx::any::AnyRow) -> Result<Self, sqlx::Error> {
        let last_xp_at_raw: String = row.try_get("last_xp_at")?;
        Ok(Self {
            user_id: row.try_get("user_id")?,
            guild_id: row.try_get("guild_id")?,
            xp: row.try_get("xp")?,
            level: row.try_get("level")?,
            last_xp_at: datetime_from_db_text(&last_xp_at_raw)?,
        })
    }
}

/// Compute the expected level from total XP.
/// Formula: level = floor(sqrt(xp / 100))
pub fn level_for_xp(xp: i64) -> i32 {
    ((xp as f64 / 100.0).sqrt()).floor() as i32
}

/// Get or create a user's XP record in a guild.
pub async fn get_user_xp(
    pool: &DbPool,
    user_id: i64,
    guild_id: i64,
) -> Result<Option<UserXpRow>, DbError> {
    let row = sqlx::query_as::<_, UserXpRow>(
        "SELECT user_id, guild_id, xp, level, last_xp_at FROM user_xp
         WHERE user_id = $1 AND guild_id = $2",
    )
    .bind(user_id)
    .bind(guild_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Add XP to a user, returning (new_row, leveled_up).
pub async fn add_xp(
    pool: &DbPool,
    user_id: i64,
    guild_id: i64,
    amount: i64,
) -> Result<(UserXpRow, bool), DbError> {
    // Validate input: reject negative amounts
    if amount < 0 {
        return Err(DbError::Sqlx(sqlx::Error::Protocol(
            "amount must be non-negative".to_string(),
        )));
    }

    let now = datetime_to_db_text(Utc::now());

    // Use RETURNING to get the row atomically, eliminating the race condition
    let row = sqlx::query_as::<_, UserXpRow>(
        "INSERT INTO user_xp (user_id, guild_id, xp, level, last_xp_at)
         VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (user_id, guild_id)
         DO UPDATE SET xp = user_xp.xp + $3, last_xp_at = $4
         RETURNING user_id, guild_id, xp, level, last_xp_at",
    )
    .bind(user_id)
    .bind(guild_id)
    .bind(amount)
    .bind(&now)
    .fetch_one(pool)
    .await?;

    let new_level = level_for_xp(row.xp);
    let leveled_up = new_level > row.level;

    if new_level != row.level {
        sqlx::query("UPDATE user_xp SET level = $3 WHERE user_id = $1 AND guild_id = $2")
            .bind(user_id)
            .bind(guild_id)
            .bind(new_level)
            .execute(pool)
            .await?;
    }

    let final_row = UserXpRow {
        level: new_level,
        ..row
    };

    Ok((final_row, leveled_up))
}

/// Get the leaderboard for a guild, ordered by XP descending.
pub async fn get_leaderboard(
    pool: &DbPool,
    guild_id: i64,
    limit: i64,
) -> Result<Vec<UserXpRow>, DbError> {
    let rows = sqlx::query_as::<_, UserXpRow>(
        "SELECT user_id, guild_id, xp, level, last_xp_at FROM user_xp
         WHERE guild_id = $1
         ORDER BY xp DESC
         LIMIT $2",
    )
    .bind(guild_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
