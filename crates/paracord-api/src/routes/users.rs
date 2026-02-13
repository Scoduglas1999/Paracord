use axum::{extract::State, Json};
use paracord_core::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::middleware::AuthUser;

pub async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, ApiError> {
    let user = paracord_db::users::get_user_by_id(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;

    Ok(Json(json!({
        "id": user.id.to_string(),
        "username": user.username,
        "discriminator": user.discriminator,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_hash": user.avatar_hash,
        "banner_hash": user.banner_hash,
        "bio": user.bio,
        "flags": user.flags,
        "created_at": user.created_at.to_rfc3339(),
    })))
}

#[derive(Deserialize)]
pub struct UpdateMeRequest {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_hash: Option<String>,
}

pub async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateMeRequest>,
) -> Result<Json<Value>, ApiError> {
    let updated = paracord_core::user::update_profile(
        &state.db,
        auth.user_id,
        body.display_name.as_deref(),
        body.bio.as_deref(),
        body.avatar_hash.as_deref(),
    )
    .await?;

    Ok(Json(json!({
        "id": updated.id.to_string(),
        "username": updated.username,
        "discriminator": updated.discriminator,
        "email": updated.email,
        "display_name": updated.display_name,
        "avatar_hash": updated.avatar_hash,
        "banner_hash": updated.banner_hash,
        "bio": updated.bio,
        "flags": updated.flags,
        "created_at": updated.created_at.to_rfc3339(),
    })))
}

pub async fn get_settings(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, ApiError> {
    let settings = paracord_db::users::get_user_settings(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    if let Some(s) = settings {
        Ok(Json(json!({
            "user_id": s.user_id.to_string(),
            "theme": s.theme,
            "locale": s.locale,
            "message_display_compact": s.message_display == "compact",
            "custom_css": s.custom_css,
            "status": "online",
            "custom_status": null,
            "crypto_auth_enabled": s.crypto_auth_enabled,
            "notifications": s.notifications,
            "keybinds": s.keybinds,
        })))
    } else {
        Ok(Json(json!({
            "user_id": auth.user_id.to_string(),
            "theme": "dark",
            "locale": "en-US",
            "message_display_compact": false,
            "custom_css": null,
            "status": "online",
            "custom_status": null,
            "crypto_auth_enabled": false,
            "notifications": {},
            "keybinds": {},
        })))
    }
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub theme: Option<String>,
    pub locale: Option<String>,
    pub message_display_compact: Option<bool>,
    pub custom_css: Option<String>,
    pub status: Option<String>,
    pub custom_status: Option<String>,
    pub crypto_auth_enabled: Option<bool>,
    pub notifications: Option<serde_json::Value>,
    pub keybinds: Option<serde_json::Value>,
}

pub async fn update_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<Value>, ApiError> {
    let existing = paracord_db::users::get_user_settings(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let theme = body
        .theme
        .as_deref()
        .or_else(|| existing.as_ref().map(|s| s.theme.as_str()))
        .unwrap_or("dark");
    let locale = body
        .locale
        .as_deref()
        .or_else(|| existing.as_ref().map(|s| s.locale.as_str()))
        .unwrap_or("en-US");
    let message_display = if let Some(is_compact) = body.message_display_compact {
        if is_compact {
            "compact"
        } else {
            "cozy"
        }
    } else if let Some(existing_settings) = existing.as_ref() {
        if existing_settings.message_display == "compact" {
            "compact"
        } else {
            "cozy"
        }
    } else {
        "cozy"
    };

    let settings = paracord_db::users::upsert_user_settings(
        &state.db,
        auth.user_id,
        theme,
        locale,
        message_display,
        body.custom_css.as_deref(),
        body.crypto_auth_enabled,
        body.notifications.as_ref(),
        body.keybinds.as_ref(),
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(Json(json!({
        "user_id": settings.user_id.to_string(),
        "theme": settings.theme,
        "locale": settings.locale,
        "message_display_compact": settings.message_display == "compact",
        "custom_css": settings.custom_css,
        "status": body.status.unwrap_or_else(|| "online".to_string()),
        "custom_status": body.custom_status,
        "crypto_auth_enabled": settings.crypto_auth_enabled,
        "notifications": settings.notifications,
        "keybinds": settings.keybinds,
    })))
}

pub async fn get_read_states(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, ApiError> {
    let rows = paracord_db::read_states::get_user_read_states(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let result: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "channel_id": row.channel_id.to_string(),
                "last_message_id": row.last_message_id.to_string(),
                "mention_count": row.mention_count,
            })
        })
        .collect();
    Ok(Json(json!(result)))
}
