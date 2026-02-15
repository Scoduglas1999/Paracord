use chrono::{DateTime, Utc};
use paracord_db::DbPool;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// Version of the identity bundle format.
const BUNDLE_VERSION: u32 = 1;

/// Maximum number of messages that can be exported.
const MAX_EXPORT_MESSAGES: i64 = 50_000;

// ── Export types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityBundle {
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub origin_server: String,
    pub user: UserExport,
    #[serde(default)]
    pub messages: Vec<MessageExport>,
    #[serde(default)]
    pub relationships: Vec<RelationshipExport>,
    #[serde(default)]
    pub guilds: Vec<GuildMembershipExport>,
    /// ed25519 signature of the canonical JSON payload (everything except this field).
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserExport {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_hash: Option<String>,
    pub bio: Option<String>,
    pub public_key: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageExport {
    pub id: String,
    pub channel_id: String,
    pub content: Option<String>,
    pub message_type: i16,
    pub flags: i32,
    pub pinned: bool,
    pub reference_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipExport {
    pub target_username: String,
    pub target_discriminator: i16,
    pub rel_type: i16,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuildMembershipExport {
    pub guild_name: String,
    pub guild_id: String,
    pub nick: Option<String>,
    pub joined_at: DateTime<Utc>,
}

/// Result of an identity import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub profile_updated: bool,
    pub messages_imported: u64,
    pub relationships_found: u64,
    pub guilds_noted: u64,
    pub warnings: Vec<String>,
}

// ── Signable payload ───────────────────────────────────────────────────────

/// Build the canonical JSON payload for signing (the bundle without the signature field).
#[derive(Serialize)]
struct SignablePayload<'a> {
    version: u32,
    exported_at: &'a DateTime<Utc>,
    origin_server: &'a str,
    user: &'a UserExport,
    messages: &'a [MessageExport],
    relationships: &'a [RelationshipExport],
    guilds: &'a [GuildMembershipExport],
}

fn build_signable_bytes(bundle: &IdentityBundle) -> Vec<u8> {
    let payload = SignablePayload {
        version: bundle.version,
        exported_at: &bundle.exported_at,
        origin_server: &bundle.origin_server,
        user: &bundle.user,
        messages: &bundle.messages,
        relationships: &bundle.relationships,
        guilds: &bundle.guilds,
    };
    serde_json::to_vec(&payload).unwrap_or_default()
}

// ── Export ──────────────────────────────────────────────────────────────────

pub async fn export_identity(
    pool: &DbPool,
    user_id: i64,
    include_messages: bool,
    origin_server: &str,
    signing_key: &ed25519_dalek::SigningKey,
) -> Result<IdentityBundle, CoreError> {
    // Fetch user
    let user = paracord_db::users::get_user_by_id(pool, user_id)
        .await?
        .ok_or(CoreError::NotFound)?;

    let user_export = UserExport {
        username: user.username,
        display_name: user.display_name,
        avatar_hash: user.avatar_hash,
        bio: user.bio,
        public_key: user.public_key,
        created_at: user.created_at,
    };

    // Fetch messages if requested
    let messages = if include_messages {
        let msg_rows =
            paracord_db::messages::list_messages_by_author(pool, user_id, MAX_EXPORT_MESSAGES)
                .await?;
        msg_rows
            .into_iter()
            .map(|m| MessageExport {
                id: m.id.to_string(),
                channel_id: m.channel_id.to_string(),
                content: m.content,
                message_type: m.message_type,
                flags: m.flags,
                pinned: m.pinned,
                reference_id: m.reference_id.map(|id| id.to_string()),
                created_at: m.created_at,
                edited_at: m.edited_at,
            })
            .collect()
    } else {
        vec![]
    };

    // Fetch relationships
    let rel_rows = paracord_db::relationships::get_relationships(pool, user_id).await?;
    let relationships: Vec<RelationshipExport> = rel_rows
        .into_iter()
        .map(|r| RelationshipExport {
            target_username: r.target_username,
            target_discriminator: r.target_discriminator,
            rel_type: r.rel_type,
            created_at: r.created_at,
        })
        .collect();

    // Fetch guild memberships
    let guild_rows = paracord_db::guilds::get_user_guilds(pool, user_id).await?;
    let mut guilds = Vec::new();
    for g in guild_rows {
        let member = paracord_db::members::get_member(pool, user_id, g.id).await?;
        guilds.push(GuildMembershipExport {
            guild_name: g.name,
            guild_id: g.id.to_string(),
            nick: member.as_ref().and_then(|m| m.nick.clone()),
            joined_at: member.map(|m| m.joined_at).unwrap_or(g.created_at),
        });
    }

    // Build unsigned bundle and sign it
    let now = Utc::now();
    let mut bundle = IdentityBundle {
        version: BUNDLE_VERSION,
        exported_at: now,
        origin_server: origin_server.to_string(),
        user: user_export,
        messages,
        relationships,
        guilds,
        signature: String::new(), // placeholder
    };

    let signable = build_signable_bytes(&bundle);
    bundle.signature = paracord_federation::signing::sign(signing_key, &signable);

    Ok(bundle)
}

// ── Verify ─────────────────────────────────────────────────────────────────

pub fn verify_identity_bundle(
    bundle: &IdentityBundle,
    server_public_key_hex: &str,
) -> Result<(), CoreError> {
    if bundle.version != BUNDLE_VERSION {
        return Err(CoreError::BadRequest(format!(
            "unsupported bundle version: {}",
            bundle.version
        )));
    }

    let signable = build_signable_bytes(bundle);
    paracord_federation::signing::verify(&signable, &bundle.signature, server_public_key_hex)
        .map_err(|_| CoreError::BadRequest("invalid bundle signature".to_string()))
}

// ── Import ─────────────────────────────────────────────────────────────────

pub async fn import_identity(
    pool: &DbPool,
    bundle: &IdentityBundle,
    target_user_id: i64,
) -> Result<ImportResult, CoreError> {
    let mut warnings = Vec::new();

    // 1. Update user profile with exported data
    let profile_updated = {
        let display_name = bundle.user.display_name.as_deref();
        let bio = bundle.user.bio.as_deref();
        let avatar = bundle.user.avatar_hash.as_deref();
        let result =
            paracord_db::users::update_user(pool, target_user_id, display_name, bio, avatar).await;
        match result {
            Ok(_) => true,
            Err(e) => {
                warnings.push(format!("failed to update profile: {}", e));
                false
            }
        }
    };

    // 2. Import messages as attributed records (mark as imported via flags)
    let mut messages_imported: u64 = 0;
    const IMPORTED_FLAG: i32 = 1 << 4; // bit 4 = imported message
    for msg in &bundle.messages {
        let msg_id = paracord_util::snowflake::generate(0);
        let channel_id: i64 = match msg.channel_id.parse() {
            Ok(id) => id,
            Err(_) => {
                warnings.push(format!(
                    "skipping message with invalid channel_id: {}",
                    msg.channel_id
                ));
                continue;
            }
        };
        let content = msg.content.as_deref().unwrap_or("");
        let flags = msg.flags | IMPORTED_FLAG;
        let result = paracord_db::messages::create_message_with_meta(
            pool,
            msg_id,
            channel_id,
            target_user_id,
            content,
            msg.message_type,
            None, // reference_id - don't preserve cross-server references
            flags,
            None,
            None,
        )
        .await;
        match result {
            Ok(_) => messages_imported += 1,
            Err(_) => {
                // Channel may not exist on this server - that's expected
            }
        }
    }

    // 3. Note relationships (we can't re-create them without the target user existing)
    let relationships_found = bundle.relationships.len() as u64;
    if !bundle.relationships.is_empty() {
        warnings.push(format!(
            "{} relationships noted but cannot be automatically re-established (users must exist on this server)",
            relationships_found
        ));
    }

    // 4. Note guild memberships
    let guilds_noted = bundle.guilds.len() as u64;
    if !bundle.guilds.is_empty() {
        warnings.push(format!(
            "{} guild memberships noted from origin server (join guilds manually via invite)",
            guilds_noted
        ));
    }

    Ok(ImportResult {
        profile_updated,
        messages_imported,
        relationships_found,
        guilds_noted,
        warnings,
    })
}
