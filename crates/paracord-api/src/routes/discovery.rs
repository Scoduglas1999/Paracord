use axum::{
    extract::{Query, State},
    Json,
};
use paracord_core::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct DiscoveryQuery {
    pub search: Option<String>,
    pub tag: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_discoverable_guilds(
    State(state): State<AppState>,
    Query(params): Query<DiscoveryQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = params.limit.unwrap_or(20).min(50);
    let offset = params.offset.unwrap_or(0).max(0);

    // Get all guilds and filter by public visibility for discovery.
    let all_guilds = paracord_db::guilds::list_all_guilds(&state.db)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let mut discoverable: Vec<_> = all_guilds
        .into_iter()
        .filter(|g| g.visibility.eq_ignore_ascii_case("public"))
        .collect();

    // Filter by search query
    if let Some(ref search) = params.search {
        let search_lower = search.to_lowercase();
        discoverable.retain(|g| {
            g.name.to_lowercase().contains(&search_lower)
                || g.description
                    .as_deref()
                    .map(|d| d.to_lowercase().contains(&search_lower))
                    .unwrap_or(false)
        });
    }

    // Filter by tag
    if let Some(ref tag) = params.tag {
        let tag_lower = tag.to_lowercase();
        discoverable.retain(|g| {
            let tags = parse_discovery_tags(&g.allowed_roles);
            tags.iter().any(|t| t.to_lowercase() == tag_lower)
        });
    }

    let total = discoverable.len() as i64;

    // Paginate
    let start = offset as usize;
    let end = (start + limit as usize).min(discoverable.len());
    let page = if start < discoverable.len() {
        &discoverable[start..end]
    } else {
        &[]
    };

    // Build online count from the state's online_users
    let online_users = state.online_users.read().await;

    let mut result = Vec::with_capacity(page.len());
    for guild in page {
        let member_count = paracord_db::members::get_member_count(&state.db, guild.id)
            .await
            .unwrap_or(0);
        let tags = parse_discovery_tags(&guild.allowed_roles);

        // Count online members for this guild
        let guild_members = paracord_db::members::get_guild_member_user_ids(&state.db, guild.id)
            .await
            .unwrap_or_default();
        let online_count = guild_members
            .iter()
            .filter(|uid| online_users.contains(uid))
            .count();

        result.push(json!({
            "id": guild.id.to_string(),
            "name": guild.name,
            "description": guild.description,
            "icon_hash": guild.icon_hash,
            "member_count": member_count,
            "online_count": online_count,
            "tags": tags,
            "created_at": guild.created_at.to_rfc3339(),
        }));
    }

    Ok(Json(json!({
        "guilds": result,
        "total": total,
    })))
}

fn parse_discovery_tags(raw: &str) -> Vec<String> {
    if let Ok(tags) = serde_json::from_str::<Vec<String>>(raw) {
        return tags;
    }
    raw.split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}
