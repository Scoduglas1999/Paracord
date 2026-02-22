use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use paracord_core::AppState;
use paracord_models::permissions::Permissions;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::middleware::AuthUser;
use crate::routes::audit;

const MAX_GUILD_DESCRIPTION_LEN: usize = 1_024;

fn contains_dangerous_markup(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("<script")
        || lower.contains("javascript:")
        || lower.contains("onerror=")
        || lower.contains("onload=")
        || lower.contains("<iframe")
}

#[derive(Deserialize)]
pub struct CreateGuildRequest {
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateGuildRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub hub_settings: Option<Value>,
    pub bot_settings: Option<Value>,
}

#[derive(Deserialize)]
pub struct TransferOwnershipRequest {
    pub new_owner_id: String,
}

pub async fn create_guild(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateGuildRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if body.name.len() < 2 || body.name.len() > 100 {
        return Err(ApiError::BadRequest(
            "Guild name must be between 2 and 100 characters".into(),
        ));
    }

    let guild_id = paracord_util::snowflake::generate(1);

    let guild = paracord_core::guild::create_guild_full(
        &state.db,
        guild_id,
        &body.name,
        auth.user_id,
        body.icon.as_deref(),
    )
    .await?;

    let guild_json = json!({
        "id": guild.id.to_string(),
        "name": guild.name,
        "description": guild.description,
        "icon_hash": guild.icon_hash,
        "owner_id": guild.owner_id.to_string(),
        "member_count": 1,
        "created_at": guild.created_at.to_rfc3339(),
        "hub_settings": guild.hub_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
        "bot_settings": guild.bot_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
    });

    state.member_index.add_member(guild_id, auth.user_id);
    state
        .event_bus
        .dispatch("GUILD_CREATE", guild_json.clone(), Some(guild_id));

    Ok((StatusCode::CREATED, Json(guild_json)))
}

pub async fn list_guilds(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, ApiError> {
    let guilds = paracord_db::guilds::get_user_guilds(&state.db, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let result: Vec<Value> = guilds
        .iter()
        .map(|g| {
            json!({
                "id": g.id.to_string(),
                "name": g.name,
                "description": g.description,
                "icon_hash": g.icon_hash,
                "owner_id": g.owner_id.to_string(),
                "created_at": g.created_at.to_rfc3339(),
                "hub_settings": g.hub_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
                "bot_settings": g.bot_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
            })
        })
        .collect();

    Ok(Json(json!(result)))
}

pub async fn get_guild(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;

    let guild = paracord_db::guilds::get_guild(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;

    let member_count = paracord_db::members::get_member_count(&state.db, guild_id)
        .await
        .unwrap_or(0);

    Ok(Json(json!({
        "id": guild.id.to_string(),
        "name": guild.name,
        "description": guild.description,
        "icon_hash": guild.icon_hash,
        "owner_id": guild.owner_id.to_string(),
        "member_count": member_count,
        "created_at": guild.created_at.to_rfc3339(),
        "hub_settings": guild.hub_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
        "bot_settings": guild.bot_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
    })))
}

pub async fn update_guild(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<UpdateGuildRequest>,
) -> Result<Json<Value>, ApiError> {
    if let Some(description) = body.description.as_deref() {
        if description.trim().len() > MAX_GUILD_DESCRIPTION_LEN {
            return Err(ApiError::BadRequest("description is too long".into()));
        }
        if contains_dangerous_markup(description) {
            return Err(ApiError::BadRequest(
                "description contains unsafe markup".into(),
            ));
        }
    }

    let hub_settings_str = body
        .hub_settings
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()));

    let bot_settings_str = body
        .bot_settings
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()));

    let updated = paracord_core::guild::update_guild(
        &state.db,
        guild_id,
        auth.user_id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.icon.as_deref(),
        hub_settings_str.as_deref(),
        bot_settings_str.as_deref(),
    )
    .await?;

    let guild_json = json!({
        "id": updated.id.to_string(),
        "name": updated.name,
        "description": updated.description,
        "icon_hash": updated.icon_hash,
        "owner_id": updated.owner_id.to_string(),
        "created_at": updated.created_at.to_rfc3339(),
        "hub_settings": updated.hub_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
        "bot_settings": updated.bot_settings.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
    });

    state
        .event_bus
        .dispatch("GUILD_UPDATE", guild_json.clone(), Some(guild_id));
    audit::log_action(
        &state,
        guild_id,
        auth.user_id,
        audit::ACTION_GUILD_UPDATE,
        Some(guild_id),
        None,
        Some(json!({
            "name": updated.name,
            "description": updated.description,
        })),
    )
    .await;

    Ok(Json(guild_json))
}

pub async fn delete_guild(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    paracord_core::guild::delete_guild(&state.db, guild_id, auth.user_id).await?;

    state.member_index.remove_guild(guild_id);
    state.event_bus.dispatch(
        "GUILD_DELETE",
        json!({"id": guild_id.to_string()}),
        Some(guild_id),
    );
    audit::log_action(
        &state,
        guild_id,
        auth.user_id,
        audit::ACTION_GUILD_UPDATE,
        Some(guild_id),
        Some("guild deleted"),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn transfer_ownership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<TransferOwnershipRequest>,
) -> Result<Json<Value>, ApiError> {
    let new_owner_id = body
        .new_owner_id
        .parse::<i64>()
        .map_err(|_| ApiError::BadRequest("Invalid new_owner_id".into()))?;
    let guild = paracord_db::guilds::get_guild(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if guild.owner_id != auth.user_id {
        return Err(ApiError::Forbidden);
    }
    let is_member = paracord_db::members::get_member(&state.db, new_owner_id, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .is_some();
    if !is_member {
        return Err(ApiError::BadRequest(
            "New owner must be a guild member".into(),
        ));
    }
    let updated = paracord_db::guilds::transfer_ownership(&state.db, guild_id, new_owner_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let payload = json!({
        "id": updated.id.to_string(),
        "owner_id": updated.owner_id.to_string(),
    });
    state
        .event_bus
        .dispatch("GUILD_UPDATE", payload.clone(), Some(guild_id));
    audit::log_action(
        &state,
        guild_id,
        auth.user_id,
        audit::ACTION_GUILD_UPDATE,
        Some(new_owner_id),
        Some("ownership transferred"),
        Some(json!({ "new_owner_id": new_owner_id.to_string() })),
    )
    .await;
    Ok(Json(payload))
}

#[derive(Deserialize)]
pub struct ChannelPositionEntry {
    pub id: String,
    pub position: i32,
    pub parent_id: Option<String>,
}

pub async fn update_channel_positions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<Vec<ChannelPositionEntry>>,
) -> Result<Json<Value>, ApiError> {
    if body.is_empty() {
        return Err(ApiError::BadRequest(
            "positions array must not be empty".into(),
        ));
    }
    if body.len() > 500 {
        return Err(ApiError::BadRequest(
            "too many channel position updates".into(),
        ));
    }

    let guild = paracord_db::guilds::get_guild(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    let roles = paracord_db::roles::get_member_roles(&state.db, auth.user_id, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let perms = paracord_core::permissions::compute_permissions_from_roles(
        &roles,
        guild.owner_id,
        auth.user_id,
    );
    paracord_core::permissions::require_permission(perms, Permissions::MANAGE_CHANNELS)?;

    let mut updates = Vec::with_capacity(body.len());
    for entry in &body {
        let channel_id = entry
            .id
            .parse::<i64>()
            .map_err(|_| ApiError::BadRequest("Invalid channel id".into()))?;
        let parent_id = match &entry.parent_id {
            Some(pid) => {
                if pid.is_empty() || pid == "null" {
                    Some(None)
                } else {
                    Some(Some(pid.parse::<i64>().map_err(|_| {
                        ApiError::BadRequest("Invalid parent_id".into())
                    })?))
                }
            }
            None => None,
        };
        updates.push((channel_id, entry.position, parent_id));
    }

    let changed = paracord_db::channels::update_channel_positions(&state.db, guild_id, &updates)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    for channel in &changed {
        let channel_json = crate::routes::channels::channel_to_json(channel);
        state
            .event_bus
            .dispatch("CHANNEL_UPDATE", channel_json, Some(guild_id));
    }

    Ok(Json(json!({ "updated": changed.len() })))
}

pub async fn get_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;
    let guild = paracord_db::guilds::get_guild(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;

    let channels = paracord_db::channels::get_guild_channels(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let mut result: Vec<Value> = Vec::with_capacity(channels.len());
    for c in channels {
        let perms = paracord_core::permissions::compute_channel_permissions(
            &state.db,
            guild_id,
            c.id,
            guild.owner_id,
            auth.user_id,
        )
        .await?;
        if !perms.contains(Permissions::VIEW_CHANNEL) {
            continue;
        }
        let required_role_ids: Vec<String> =
            paracord_db::channels::parse_required_role_ids(&c.required_role_ids)
                .into_iter()
                .map(|id| id.to_string())
                .collect();
        result.push(json!({
            "id": c.id.to_string(),
            "guild_id": c.guild_id().map(|id| id.to_string()),
            "name": c.name,
            "topic": c.topic,
            "type": c.channel_type,
            "channel_type": c.channel_type,
            "position": c.position,
            "parent_id": c.parent_id.map(|id| id.to_string()),
            "nsfw": c.nsfw,
            "rate_limit_per_user": c.rate_limit_per_user,
            "last_message_id": c.last_message_id.map(|id| id.to_string()),
            "required_role_ids": required_role_ids,
        }));
    }

    Ok(Json(json!(result)))
}

// ── Guild Storage ────────────────────────────────────────────────────────

async fn require_manage_guild(
    state: &AppState,
    guild_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, user_id).await?;
    let guild = paracord_db::guilds::get_guild(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    let roles = paracord_db::roles::get_member_roles(&state.db, user_id, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let perms = paracord_core::permissions::compute_permissions_from_roles(
        &roles,
        guild.owner_id,
        user_id,
    );
    paracord_core::permissions::require_permission(perms, Permissions::MANAGE_GUILD)?;
    Ok(())
}

pub async fn get_storage(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    require_manage_guild(&state, guild_id, auth.user_id).await?;

    let usage = paracord_db::guild_storage_policies::get_guild_storage_usage(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let policy =
        paracord_db::guild_storage_policies::get_guild_storage_policy(&state.db, guild_id)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let server_quota = state.config.max_guild_storage_quota;
    let quota = policy
        .as_ref()
        .and_then(|p| p.storage_quota)
        .map(|q| (q as u64).min(server_quota))
        .unwrap_or(server_quota);

    let policy_json = policy.map(|p| {
        json!({
            "max_file_size": p.max_file_size,
            "storage_quota": p.storage_quota,
            "retention_days": p.retention_days,
            "allowed_types": p.allowed_types.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
            "blocked_types": p.blocked_types.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
            "updated_at": p.updated_at,
        })
    });

    Ok(Json(json!({
        "usage": usage,
        "quota": quota,
        "policy": policy_json,
    })))
}

#[derive(Deserialize)]
pub struct UpdateStorageRequest {
    pub max_file_size: Option<i64>,
    pub storage_quota: Option<i64>,
    pub retention_days: Option<i32>,
    pub allowed_types: Option<Vec<String>>,
    pub blocked_types: Option<Vec<String>>,
}

pub async fn update_storage(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<UpdateStorageRequest>,
) -> Result<Json<Value>, ApiError> {
    require_manage_guild(&state, guild_id, auth.user_id).await?;

    let server_quota = state.config.max_guild_storage_quota;

    if let Some(quota) = body.storage_quota {
        if quota < 0 {
            return Err(ApiError::BadRequest(
                "storage_quota must be non-negative".into(),
            ));
        }
        if (quota as u64) > server_quota {
            return Err(ApiError::BadRequest(format!(
                "storage_quota cannot exceed server limit of {} bytes",
                server_quota
            )));
        }
    }
    if let Some(size) = body.max_file_size {
        if size < 0 {
            return Err(ApiError::BadRequest(
                "max_file_size must be non-negative".into(),
            ));
        }
    }
    if let Some(days) = body.retention_days {
        if days < 0 {
            return Err(ApiError::BadRequest(
                "retention_days must be non-negative".into(),
            ));
        }
    }

    let allowed_types_json = body
        .allowed_types
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
    let blocked_types_json = body
        .blocked_types
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));

    let policy = paracord_db::guild_storage_policies::upsert_guild_storage_policy(
        &state.db,
        guild_id,
        body.max_file_size,
        body.storage_quota,
        body.retention_days,
        allowed_types_json.as_deref(),
        blocked_types_json.as_deref(),
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(Json(json!({
        "guild_id": policy.guild_id.to_string(),
        "max_file_size": policy.max_file_size,
        "storage_quota": policy.storage_quota,
        "retention_days": policy.retention_days,
        "allowed_types": policy.allowed_types.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
        "blocked_types": policy.blocked_types.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok()),
        "updated_at": policy.updated_at,
    })))
}

#[derive(Deserialize)]
pub struct ListFilesParams {
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

pub async fn list_files(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Query(params): Query<ListFilesParams>,
) -> Result<Json<Value>, ApiError> {
    require_manage_guild(&state, guild_id, auth.user_id).await?;

    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let attachments = paracord_db::guild_storage_policies::get_guild_attachments(
        &state.db,
        guild_id,
        params.before,
        limit,
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let files: Vec<Value> = attachments
        .iter()
        .map(|a| {
            json!({
                "id": a.id.to_string(),
                "filename": a.filename,
                "size": a.size,
                "content_type": a.content_type,
                "url": a.url,
                "message_id": a.message_id.map(|id| id.to_string()),
                "uploader_id": a.uploader_id.map(|id| id.to_string()),
                "upload_channel_id": a.upload_channel_id.map(|id| id.to_string()),
                "content_hash": a.content_hash,
                "created_at": a.upload_created_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(json!(files)))
}

#[derive(Deserialize)]
pub struct DeleteFilesRequest {
    pub attachment_ids: Vec<String>,
}

pub async fn delete_files(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<DeleteFilesRequest>,
) -> Result<Json<Value>, ApiError> {
    require_manage_guild(&state, guild_id, auth.user_id).await?;

    if body.attachment_ids.is_empty() {
        return Err(ApiError::BadRequest(
            "attachment_ids must not be empty".into(),
        ));
    }
    if body.attachment_ids.len() > 100 {
        return Err(ApiError::BadRequest(
            "cannot delete more than 100 attachments at once".into(),
        ));
    }

    let mut deleted = 0_u64;
    for id_str in &body.attachment_ids {
        let attachment_id = id_str
            .parse::<i64>()
            .map_err(|_| ApiError::BadRequest(format!("invalid attachment id: {}", id_str)))?;

        let attachment =
            match paracord_db::attachments::get_attachment(&state.db, attachment_id).await {
                Ok(Some(a)) => a,
                _ => continue,
            };

        // Verify the attachment belongs to this guild
        if let Some(channel_id) = attachment.upload_channel_id {
            let channel = paracord_db::channels::get_channel(&state.db, channel_id)
                .await
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            if channel.as_ref().and_then(|c| c.guild_id()) != Some(guild_id) {
                continue;
            }
        } else {
            continue;
        }

        if paracord_db::attachments::delete_attachment(&state.db, attachment_id)
            .await
            .is_ok()
        {
            let ext = std::path::Path::new(&attachment.filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("bin");
            let storage_key = format!("attachments/{}.{}", attachment.id, ext);
            let _ = state.storage_backend.delete(&storage_key).await;
            deleted += 1;
        }
    }

    Ok(Json(json!({ "deleted": deleted })))
}
