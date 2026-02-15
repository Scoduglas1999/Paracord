use axum::http::{header, HeaderMap};
use paracord_core::AppState;
use serde_json::Value;

fn header_opt(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|raw| raw.split(',').next())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn request_metadata(
    headers: Option<&HeaderMap>,
) -> (Option<String>, Option<String>, Option<String>) {
    let Some(headers) = headers else {
        return (None, None, None);
    };
    let device_id = header_opt(headers, "x-device-id");
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let trust_proxy = std::env::var("PARACORD_TRUST_PROXY")
        .ok()
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false);
    let trusted_proxy_configured = std::env::var("PARACORD_TRUSTED_PROXY_IPS")
        .ok()
        .map(|raw| !raw.trim().is_empty())
        .unwrap_or(false);
    let ip_address = if trust_proxy && trusted_proxy_configured {
        header_opt(headers, "x-forwarded-for")
    } else {
        None
    };
    (device_id, user_agent, ip_address)
}

pub async fn log_security_event(
    state: &AppState,
    action: &str,
    actor_user_id: Option<i64>,
    target_user_id: Option<i64>,
    session_id: Option<&str>,
    headers: Option<&HeaderMap>,
    details: Option<Value>,
) {
    let (device_id, user_agent, ip_address) = request_metadata(headers);
    let id = paracord_util::snowflake::generate(1);
    let details_ref = details.as_ref();

    if let Err(err) = paracord_db::security_events::create_event(
        &state.db,
        id,
        actor_user_id,
        action,
        target_user_id,
        session_id,
        device_id.as_deref(),
        user_agent.as_deref(),
        ip_address.as_deref(),
        details_ref,
    )
    .await
    {
        tracing::warn!("failed to write security event '{}': {}", action, err);
    }
}
