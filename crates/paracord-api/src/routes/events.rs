use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use paracord_core::AppState;
use paracord_models::permissions::Permissions;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::middleware::AuthUser;

const MAX_EVENT_NAME_LEN: usize = 100;
const MAX_EVENT_DESCRIPTION_LEN: usize = 1000;
const MAX_EVENT_LOCATION_LEN: usize = 200;

fn contains_dangerous_markup(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("<script")
        || lower.contains("javascript:")
        || lower.contains("onerror=")
        || lower.contains("onload=")
        || lower.contains("<iframe")
}

fn event_to_json(
    e: &paracord_db::scheduled_events::ScheduledEventRow,
    rsvp_count: i64,
    user_rsvp: bool,
) -> Value {
    json!({
        "id": e.id.to_string(),
        "guild_id": e.guild_id.to_string(),
        "channel_id": e.channel_id.map(|id| id.to_string()),
        "creator_id": e.creator_id.to_string(),
        "name": e.name,
        "description": e.description,
        "scheduled_start": e.scheduled_start,
        "scheduled_end": e.scheduled_end,
        "status": e.status,
        "entity_type": e.entity_type,
        "location": e.location,
        "image_url": e.image_url,
        "user_count": rsvp_count,
        "user_rsvp": user_rsvp,
        "created_at": e.created_at.to_rfc3339(),
    })
}

#[derive(Deserialize)]
pub struct CreateEventRequest {
    pub name: String,
    pub description: Option<String>,
    pub scheduled_start: String,
    pub scheduled_end: Option<String>,
    #[serde(default = "default_entity_type")]
    pub entity_type: i32,
    pub channel_id: Option<String>,
    pub location: Option<String>,
    pub image_url: Option<String>,
}

fn default_entity_type() -> i32 {
    1
}

#[derive(Deserialize)]
pub struct UpdateEventRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub status: Option<i32>,
    pub channel_id: Option<String>,
    pub location: Option<String>,
    pub image_url: Option<String>,
}

async fn ensure_manage_events(
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
    let perms =
        paracord_core::permissions::compute_permissions_from_roles(&roles, guild.owner_id, user_id);
    // MANAGE_EVENTS maps to MANAGE_GUILD for now
    paracord_core::permissions::require_permission(perms, Permissions::MANAGE_GUILD)?;
    Ok(())
}

pub async fn create_event(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
    Json(body): Json<CreateEventRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ensure_manage_events(&state, guild_id, auth.user_id).await?;

    if body.name.trim().is_empty() || body.name.len() > MAX_EVENT_NAME_LEN {
        return Err(ApiError::BadRequest(
            "Event name must be 1-100 characters".into(),
        ));
    }
    if contains_dangerous_markup(&body.name) {
        return Err(ApiError::BadRequest(
            "Event name contains unsafe markup".into(),
        ));
    }
    if let Some(ref desc) = body.description {
        if desc.len() > MAX_EVENT_DESCRIPTION_LEN {
            return Err(ApiError::BadRequest("Description too long".into()));
        }
        if contains_dangerous_markup(desc) {
            return Err(ApiError::BadRequest(
                "Description contains unsafe markup".into(),
            ));
        }
    }
    if let Some(ref loc) = body.location {
        if loc.len() > MAX_EVENT_LOCATION_LEN {
            return Err(ApiError::BadRequest("Location too long".into()));
        }
    }
    if body.entity_type != 1 && body.entity_type != 2 {
        return Err(ApiError::BadRequest("Invalid entity type".into()));
    }

    let channel_id = match body.channel_id.as_deref() {
        Some(raw) => Some(
            raw.parse::<i64>()
                .map_err(|_| ApiError::BadRequest("Invalid channel_id".into()))?,
        ),
        None => None,
    };

    let event_id = paracord_util::snowflake::generate(1);
    let event = paracord_db::scheduled_events::create_event(
        &state.db,
        event_id,
        guild_id,
        auth.user_id,
        body.name.trim(),
        body.description.as_deref(),
        &body.scheduled_start,
        body.scheduled_end.as_deref(),
        body.entity_type,
        channel_id,
        body.location.as_deref(),
        body.image_url.as_deref(),
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let event_json = event_to_json(&event, 0, false);
    state.event_bus.dispatch(
        "GUILD_SCHEDULED_EVENT_CREATE",
        event_json.clone(),
        Some(guild_id),
    );

    Ok((StatusCode::CREATED, Json(event_json)))
}

pub async fn list_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;

    let events = paracord_db::scheduled_events::get_guild_events(&state.db, guild_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let mut result = Vec::with_capacity(events.len());
    for event in &events {
        let count = paracord_db::scheduled_events::get_rsvp_count(&state.db, event.id)
            .await
            .unwrap_or(0);
        let user_rsvp = paracord_db::scheduled_events::has_rsvp(&state.db, event.id, auth.user_id)
            .await
            .unwrap_or(false);
        result.push(event_to_json(event, count, user_rsvp));
    }

    Ok(Json(json!(result)))
}

pub async fn get_event(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((guild_id, event_id)): Path<(i64, i64)>,
) -> Result<Json<Value>, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;

    let event = paracord_db::scheduled_events::get_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if event.guild_id != guild_id {
        return Err(ApiError::NotFound);
    }

    let count = paracord_db::scheduled_events::get_rsvp_count(&state.db, event_id)
        .await
        .unwrap_or(0);
    let user_rsvp = paracord_db::scheduled_events::has_rsvp(&state.db, event_id, auth.user_id)
        .await
        .unwrap_or(false);

    Ok(Json(event_to_json(&event, count, user_rsvp)))
}

pub async fn update_event(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((guild_id, event_id)): Path<(i64, i64)>,
    Json(body): Json<UpdateEventRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_manage_events(&state, guild_id, auth.user_id).await?;

    let existing = paracord_db::scheduled_events::get_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if existing.guild_id != guild_id {
        return Err(ApiError::NotFound);
    }

    if let Some(ref name) = body.name {
        if name.trim().is_empty() || name.len() > MAX_EVENT_NAME_LEN {
            return Err(ApiError::BadRequest(
                "Event name must be 1-100 characters".into(),
            ));
        }
        if contains_dangerous_markup(name) {
            return Err(ApiError::BadRequest(
                "Event name contains unsafe markup".into(),
            ));
        }
    }
    if let Some(ref desc) = body.description {
        if desc.len() > MAX_EVENT_DESCRIPTION_LEN {
            return Err(ApiError::BadRequest("Description too long".into()));
        }
    }
    if let Some(status) = body.status {
        if !(1..=4).contains(&status) {
            return Err(ApiError::BadRequest("Invalid status".into()));
        }
    }

    let channel_id = match body.channel_id.as_deref() {
        Some(raw) => Some(
            raw.parse::<i64>()
                .map_err(|_| ApiError::BadRequest("Invalid channel_id".into()))?,
        ),
        None => None,
    };

    let updated = paracord_db::scheduled_events::update_event(
        &state.db,
        event_id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.scheduled_start.as_deref(),
        body.scheduled_end.as_deref(),
        body.status,
        channel_id,
        body.location.as_deref(),
        body.image_url.as_deref(),
    )
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let count = paracord_db::scheduled_events::get_rsvp_count(&state.db, event_id)
        .await
        .unwrap_or(0);
    let user_rsvp = paracord_db::scheduled_events::has_rsvp(&state.db, event_id, auth.user_id)
        .await
        .unwrap_or(false);
    let event_json = event_to_json(&updated, count, user_rsvp);

    state.event_bus.dispatch(
        "GUILD_SCHEDULED_EVENT_UPDATE",
        event_json.clone(),
        Some(guild_id),
    );

    Ok(Json(event_json))
}

pub async fn delete_event(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((guild_id, event_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    ensure_manage_events(&state, guild_id, auth.user_id).await?;

    let existing = paracord_db::scheduled_events::get_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if existing.guild_id != guild_id {
        return Err(ApiError::NotFound);
    }

    paracord_db::scheduled_events::delete_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    state.event_bus.dispatch(
        "GUILD_SCHEDULED_EVENT_DELETE",
        json!({"id": event_id.to_string(), "guild_id": guild_id.to_string()}),
        Some(guild_id),
    );

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_rsvp(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((guild_id, event_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;

    let event = paracord_db::scheduled_events::get_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if event.guild_id != guild_id {
        return Err(ApiError::NotFound);
    }

    paracord_db::scheduled_events::add_rsvp(&state.db, event_id, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    state.event_bus.dispatch(
        "GUILD_SCHEDULED_EVENT_USER_ADD",
        json!({
            "guild_scheduled_event_id": event_id.to_string(),
            "user_id": auth.user_id.to_string(),
            "guild_id": guild_id.to_string(),
        }),
        Some(guild_id),
    );

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_rsvp(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((guild_id, event_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    paracord_core::permissions::ensure_guild_member(&state.db, guild_id, auth.user_id).await?;

    let event = paracord_db::scheduled_events::get_event(&state.db, event_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
        .ok_or(ApiError::NotFound)?;
    if event.guild_id != guild_id {
        return Err(ApiError::NotFound);
    }

    paracord_db::scheduled_events::remove_rsvp(&state.db, event_id, auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    state.event_bus.dispatch(
        "GUILD_SCHEDULED_EVENT_USER_REMOVE",
        json!({
            "guild_scheduled_event_id": event_id.to_string(),
            "user_id": auth.user_id.to_string(),
            "guild_id": guild_id.to_string(),
        }),
        Some(guild_id),
    );

    Ok(StatusCode::NO_CONTENT)
}
