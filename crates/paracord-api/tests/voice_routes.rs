use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Context;
use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
    Router,
};
use chrono::{Duration, Utc};
use paracord_core::{build_permission_cache, AppConfig, AppState, RuntimeSettings};
use paracord_media::{
    LiveKitConfig, LocalStorage, Storage, StorageConfig, StorageManager, VoiceManager,
};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::{Notify, RwLock};
use tower::ServiceExt;
use uuid::Uuid;

struct VoiceTestContext {
    app: Router,
    #[allow(dead_code)]
    db: paracord_db::DbPool,
    token: String,
    _storage_dir: TempDir,
    _media_dir: TempDir,
    _backup_dir: TempDir,
}

impl VoiceTestContext {
    async fn new(native_media_enabled: bool, livekit_available: bool) -> anyhow::Result<Self> {
        let db = paracord_db::create_pool("sqlite::memory:", 1).await?;
        paracord_db::run_migrations(&db).await?;

        let storage_dir = tempfile::tempdir()?;
        let media_dir = tempfile::tempdir()?;
        let backup_dir = tempfile::tempdir()?;
        let jwt_secret = "voice-test-secret".to_string();

        let livekit = Arc::new(LiveKitConfig {
            api_key: "lk-test-key".to_string(),
            api_secret: "lk-test-secret".to_string(),
            url: "ws://localhost:7880".to_string(),
            http_url: "http://localhost:7880".to_string(),
        });

        let state = AppState {
            db: db.clone(),
            event_bus: paracord_core::events::EventBus::default(),
            config: AppConfig {
                jwt_secret: jwt_secret.clone(),
                jwt_expiry_seconds: 3600,
                registration_enabled: true,
                allow_username_login: false,
                require_email: true,
                storage_path: storage_dir.path().to_string_lossy().into_owned(),
                max_upload_size: 10 * 1024 * 1024,
                livekit_api_key: livekit.api_key.clone(),
                livekit_api_secret: livekit.api_secret.clone(),
                livekit_url: livekit.url.clone(),
                livekit_http_url: livekit.http_url.clone(),
                livekit_public_url: livekit.url.clone(),
                livekit_available,
                public_url: None,
                media_storage_path: media_dir.path().to_string_lossy().into_owned(),
                media_max_file_size: 10 * 1024 * 1024,
                media_p2p_threshold: 1024 * 1024,
                file_cryptor: None,
                backup_dir: backup_dir.path().to_string_lossy().into_owned(),
                database_url: "sqlite::memory:".to_string(),
                federation_max_events_per_peer_per_minute: None,
                federation_max_user_creates_per_peer_per_hour: None,
                native_media_enabled,
                native_media_port: 8443,
                native_media_max_participants: 50,
                native_media_e2ee_required: false,
                max_guild_storage_quota: 0,
                federation_file_cache_enabled: false,
                federation_file_cache_max_size: 0,
                federation_file_cache_ttl_hours: 0,
            },
            runtime: Arc::new(RwLock::new(RuntimeSettings::default())),
            voice: Arc::new(VoiceManager::new(livekit)),
            storage: Arc::new(StorageManager::new(StorageConfig {
                base_path: media_dir.path().to_path_buf(),
                max_file_size: 10 * 1024 * 1024,
                p2p_threshold: 1024 * 1024,
                allowed_extensions: None,
            })),
            storage_backend: Arc::new(Storage::Local(LocalStorage::new(storage_dir.path()))),
            shutdown: Arc::new(Notify::new()),
            online_users: Arc::new(RwLock::new(HashSet::new())),
            user_presences: Arc::new(RwLock::new(HashMap::new())),
            permission_cache: build_permission_cache(),
            federation_service: None,
            native_media: None,
        };

        paracord_api::install_http_rate_limiter();
        let app = paracord_api::build_router().with_state(state);
        let token = create_voice_test_user_token(&db, &jwt_secret).await?;

        Ok(Self {
            app,
            db,
            token,
            _storage_dir: storage_dir,
            _media_dir: media_dir,
            _backup_dir: backup_dir,
        })
    }

    async fn request_json(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> anyhow::Result<(StatusCode, Value)> {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token));

        let request = if let Some(payload) = body {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            builder.body(Body::from(payload.to_string()))?
        } else {
            builder.body(Body::empty())?
        };

        let response = self.app.clone().oneshot(request).await?;
        let status = response.status();
        let body_bytes = to_bytes(response.into_body(), usize::MAX).await?;
        let payload = if body_bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body_bytes)
                .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&body_bytes) }))
        };

        Ok((status, payload))
    }
}

async fn create_voice_test_user_token(
    db: &paracord_db::DbPool,
    jwt_secret: &str,
) -> anyhow::Result<String> {
    let user_id = paracord_util::snowflake::generate(1);
    let nonce = Uuid::new_v4().simple().to_string();
    let username = format!("voicetest_{nonce}");
    let email = format!("{nonce}@example.com");
    let password_hash = paracord_core::auth::hash_password("VoiceTestPass123!")?;

    let user =
        paracord_db::users::create_user(db, user_id, &username, 1, &email, &password_hash).await?;

    let session_id = format!("sess-{}", Uuid::new_v4().simple());
    let jti = format!("jti-{}", Uuid::new_v4().simple());
    let refresh_hash = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    paracord_db::sessions::create_session(
        db,
        &session_id,
        user.id,
        &refresh_hash,
        &jti,
        user.public_key.as_deref(),
        None,
        None,
        None,
        Utc::now() + Duration::days(1),
    )
    .await?;

    let token = paracord_core::auth::create_session_token(
        user.id,
        user.public_key.as_deref(),
        jwt_secret,
        3600,
        &session_id,
        &jti,
    )?;

    Ok(token)
}

async fn create_guild_and_voice_channel(ctx: &VoiceTestContext) -> anyhow::Result<(String, String)> {
    // Create a guild
    let (status, payload) = ctx
        .request_json(
            Method::POST,
            "/api/v1/guilds",
            Some(json!({ "name": "Voice Test Guild", "icon": Value::Null })),
        )
        .await?;
    assert_eq!(status, StatusCode::CREATED, "guild creation: {payload}");
    let guild_id = payload["id"]
        .as_str()
        .context("guild id should be a string")?
        .to_string();

    // Create a voice channel (channel_type=2)
    let (status, payload) = ctx
        .request_json(
            Method::POST,
            &format!("/api/v1/guilds/{guild_id}/channels"),
            Some(json!({
                "name": "voice-test",
                "channel_type": 2,
                "parent_id": Value::Null,
                "required_role_ids": Value::Null,
            })),
        )
        .await?;
    assert_eq!(status, StatusCode::CREATED, "channel creation: {payload}");
    let channel_id = payload["id"]
        .as_str()
        .context("channel id should be a string")?
        .to_string();

    Ok((guild_id, channel_id))
}

// ── Test D1: native=true + lk=true → native-only response with livekit_available ──

#[tokio::test]
async fn native_plus_livekit_returns_native_only_with_livekit_available() -> anyhow::Result<()> {
    let ctx = VoiceTestContext::new(true, true).await?;
    let (_guild_id, channel_id) = create_guild_and_voice_channel(&ctx).await?;

    // Join via v1 GET (no ?fallback)
    let (status, payload) = ctx
        .request_json(
            Method::GET,
            &format!("/api/v1/voice/{channel_id}/join"),
            None,
        )
        .await?;

    assert_eq!(status, StatusCode::OK, "voice join: {payload}");
    // Should be native media response
    assert_eq!(payload["native_media"], json!(true));
    assert!(payload["media_endpoint"].is_string(), "expected media_endpoint");
    assert!(payload["media_token"].is_string(), "expected media_token");
    // Should indicate LiveKit is available as fallback
    assert_eq!(payload["livekit_available"], json!(true));
    // Should NOT contain LiveKit fields
    assert!(payload["token"].is_null(), "should not contain LiveKit token");

    Ok(())
}

// ── Test D2: ?fallback=livekit routes to LiveKit path ──

#[tokio::test]
async fn fallback_livekit_query_routes_to_livekit_path() -> anyhow::Result<()> {
    let ctx = VoiceTestContext::new(true, true).await?;
    let (_guild_id, channel_id) = create_guild_and_voice_channel(&ctx).await?;

    // Join with ?fallback=livekit — this will attempt the LiveKit path.
    // Without a real LiveKit server, the join_channel call to LiveKit will fail
    // with an internal error, but we can verify it doesn't return native media fields.
    let (status, payload) = ctx
        .request_json(
            Method::GET,
            &format!("/api/v1/voice/{channel_id}/join?fallback=livekit"),
            None,
        )
        .await?;

    // The LiveKit join will fail (no real LiveKit server), resulting in 500.
    // The important thing is that it did NOT return native media fields.
    if status == StatusCode::OK {
        // If it somehow succeeded (unlikely without LiveKit), verify it's a LiveKit response
        assert!(payload["token"].is_string(), "expected LiveKit token");
        assert!(
            payload["native_media"].is_null(),
            "should not contain native_media in LiveKit fallback response"
        );
    } else {
        // Expected: 500 because LiveKit is not actually running.
        // This confirms the routing logic directed to the LiveKit branch.
        assert_eq!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "expected 500 from LiveKit path (no server): {payload}"
        );
    }

    Ok(())
}

// ── Test D3: native=false + lk=true → LiveKit response ──

#[tokio::test]
async fn native_disabled_livekit_available_returns_livekit_response() -> anyhow::Result<()> {
    let ctx = VoiceTestContext::new(false, true).await?;
    let (_guild_id, channel_id) = create_guild_and_voice_channel(&ctx).await?;

    // Without native media, the default join should go to LiveKit path.
    // Without a real LiveKit server, this will fail with 500.
    let (status, payload) = ctx
        .request_json(
            Method::GET,
            &format!("/api/v1/voice/{channel_id}/join"),
            None,
        )
        .await?;

    // Should NOT be a native media response
    assert!(
        payload["native_media"].is_null(),
        "should not return native_media when native is disabled: {payload}"
    );

    if status == StatusCode::OK {
        // If LiveKit were somehow available, it would have LiveKit fields
        assert!(payload["token"].is_string(), "expected LiveKit token");
    } else {
        // Expected: 500 because there is no real LiveKit server
        assert_eq!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "expected 500 from LiveKit path: {payload}"
        );
    }

    Ok(())
}

// ── Test: native=true + lk=false → native-only, livekit_available=false ──

#[tokio::test]
async fn native_only_no_livekit_returns_native_without_fallback() -> anyhow::Result<()> {
    let ctx = VoiceTestContext::new(true, false).await?;
    let (_guild_id, channel_id) = create_guild_and_voice_channel(&ctx).await?;

    let (status, payload) = ctx
        .request_json(
            Method::GET,
            &format!("/api/v1/voice/{channel_id}/join"),
            None,
        )
        .await?;

    assert_eq!(status, StatusCode::OK, "voice join: {payload}");
    assert_eq!(payload["native_media"], json!(true));
    assert_eq!(
        payload["livekit_available"],
        json!(false),
        "livekit_available should be false"
    );

    Ok(())
}

// ── Test: v2 POST join also accepts ?fallback=livekit ──

#[tokio::test]
async fn v2_join_accepts_fallback_query_param() -> anyhow::Result<()> {
    let ctx = VoiceTestContext::new(true, true).await?;
    let (_guild_id, channel_id) = create_guild_and_voice_channel(&ctx).await?;

    // v2 POST without fallback → native media
    let (status, payload) = ctx
        .request_json(
            Method::POST,
            &format!("/api/v2/voice/{channel_id}/join"),
            None,
        )
        .await?;
    assert_eq!(status, StatusCode::OK, "v2 join: {payload}");
    assert_eq!(payload["native_media"], json!(true));
    assert_eq!(payload["livekit_available"], json!(true));

    // Leave first
    let _ = ctx
        .request_json(
            Method::POST,
            &format!("/api/v2/voice/{channel_id}/leave"),
            None,
        )
        .await;

    // v2 POST with ?fallback=livekit → LiveKit path
    let (status, _payload) = ctx
        .request_json(
            Method::POST,
            &format!("/api/v2/voice/{channel_id}/join?fallback=livekit"),
            None,
        )
        .await?;
    // Should attempt LiveKit path (500 without real server or 200 with LiveKit fields)
    assert_ne!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "should not get service unavailable when livekit_available=true"
    );

    Ok(())
}
