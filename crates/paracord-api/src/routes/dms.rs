use axum::{extract::State, http::StatusCode, Json};
use paracord_core::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::middleware::AuthUser;

#[derive(Debug, Deserialize)]
pub struct CreateDmRequest {
    pub recipient_id: String,
}

pub async fn list_dms(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, ApiError> {
    let channels = paracord_db::dms::list_user_dm_channels(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let result: Vec<Value> = channels
        .iter()
        .map(|c| {
            json!({
                "id": c.id.to_string(),
                "type": c.channel_type,
                "channel_type": c.channel_type,
                "guild_id": null,
                "name": null,
                "last_message_id": c.last_message_id.map(|id| id.to_string()),
                "recipient": {
                    "id": c.recipient_id.to_string(),
                    "username": c.recipient_username,
                    "discriminator": c.recipient_discriminator,
                    "avatar_hash": c.recipient_avatar_hash,
                    "public_key": c.recipient_public_key,
                }
            })
        })
        .collect();

    Ok(Json(json!(result)))
}

pub async fn create_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateDmRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let recipient_id: i64 = body
        .recipient_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid recipient_id".into()))?;

    if recipient_id == auth.user_id {
        return Err(ApiError::BadRequest(
            "Cannot create a DM channel with yourself".into(),
        ));
    }

    let blocked = paracord_db::relationships::is_blocked_either_direction(
        &state.db,
        auth.user_id,
        recipient_id,
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    if blocked {
        return Err(ApiError::Forbidden);
    }

    let are_friends =
        paracord_db::relationships::are_friends(&state.db, auth.user_id, recipient_id)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let share_guild = paracord_db::members::share_any_guild(&state.db, auth.user_id, recipient_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    if !are_friends && !share_guild {
        return Err(ApiError::Forbidden);
    }

    let recipient = paracord_db::users::get_user_by_id(&state.db, recipient_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;

    let channel = if let Some(existing) =
        paracord_db::dms::find_dm_channel_between(&state.db, auth.user_id, recipient_id)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
    {
        existing
    } else {
        let channel_id = paracord_util::snowflake::generate(1);
        paracord_db::dms::create_dm_channel(&state.db, channel_id, auth.user_id, recipient_id)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
    };

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": channel.id.to_string(),
            "type": channel.channel_type,
            "channel_type": channel.channel_type,
            "guild_id": null,
            "name": null,
            "last_message_id": channel.last_message_id.map(|id| id.to_string()),
            "recipient": {
                "id": recipient.id.to_string(),
                "username": recipient.username,
                "discriminator": recipient.discriminator,
                "avatar_hash": recipient.avatar_hash,
                "public_key": recipient.public_key,
            }
        })),
    ))
}
