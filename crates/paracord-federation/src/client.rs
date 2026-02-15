use crate::protocol::{FederatedEvent, ServerInfo};
use crate::signing;
use crate::transport;
use crate::{FederationError, FederationEventEnvelope, FederationServerKey};
use ed25519_dalek::SigningKey;
use reqwest::Client;
use std::time::Duration;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
struct TransportSigner {
    origin: String,
    key_id: String,
    signing_key: SigningKey,
}

/// HTTP client for server-to-server federation requests.
#[derive(Debug, Clone)]
pub struct FederationClient {
    http: Client,
    transport_signer: Option<TransportSigner>,
}

impl FederationClient {
    pub fn new() -> Result<Self, FederationError> {
        Self::new_with_signer(None, None, None)
    }

    pub fn new_signed(
        origin: String,
        key_id: String,
        signing_key: SigningKey,
    ) -> Result<Self, FederationError> {
        Self::new_with_signer(Some(origin), Some(key_id), Some(signing_key))
    }

    fn new_with_signer(
        origin: Option<String>,
        key_id: Option<String>,
        signing_key: Option<SigningKey>,
    ) -> Result<Self, FederationError> {
        let http = Client::builder()
            .timeout(DEFAULT_TIMEOUT)
            .user_agent("Paracord-Federation/0.4")
            .build()
            .map_err(|e| FederationError::Http(e.to_string()))?;

        let transport_signer = match (origin, key_id, signing_key) {
            (Some(origin), Some(key_id), Some(signing_key)) => Some(TransportSigner {
                origin,
                key_id,
                signing_key,
            }),
            _ => None,
        };

        Ok(Self {
            http,
            transport_signer,
        })
    }

    /// Discover a remote server's federation info via its `.well-known` endpoint.
    pub async fn fetch_server_info(&self, base_url: &str) -> Result<ServerInfo, FederationError> {
        let url = format!(
            "{}/.well-known/paracord/server",
            base_url.trim_end_matches('/')
        );
        let resp = self.get_with_retry(&url).await?;
        let info: ServerInfo = resp
            .json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid server info: {e}")))?;
        Ok(info)
    }

    /// Fetch the public keys of a remote server.
    pub async fn fetch_server_keys(
        &self,
        federation_endpoint: &str,
    ) -> Result<FederationKeysResponse, FederationError> {
        let url = format!("{}/keys", federation_endpoint.trim_end_matches('/'));
        let resp = self.get_with_retry(&url).await?;
        let keys: FederationKeysResponse = resp
            .json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid keys response: {e}")))?;
        Ok(keys)
    }

    /// Send a federation event envelope to a remote server.
    pub async fn post_event(
        &self,
        federation_endpoint: &str,
        envelope: &FederationEventEnvelope,
    ) -> Result<PostEventResponse, FederationError> {
        let url = format!("{}/event", federation_endpoint.trim_end_matches('/'));
        let body_bytes =
            serde_json::to_vec(envelope).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body_bytes).await?;
        let body: PostEventResponse = resp
            .json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid event response: {e}")))?;
        Ok(body)
    }

    /// Send a federated event (higher-level type) to a remote server by
    /// converting it into the envelope format expected by the ingest endpoint.
    pub async fn send_event(
        &self,
        federation_endpoint: &str,
        event: &FederatedEvent,
    ) -> Result<PostEventResponse, FederationError> {
        let envelope = FederationEventEnvelope {
            event_id: event.event_id.clone(),
            room_id: event.room_id.clone().unwrap_or_default(),
            event_type: event.event_type.clone(),
            sender: event.sender.clone(),
            origin_server: event.origin_server.clone(),
            origin_ts: event.origin_ts,
            content: event.content.clone(),
            depth: 0,
            state_key: None,
            signatures: event.signatures.clone(),
        };
        self.post_event(federation_endpoint, &envelope).await
    }

    /// Fetch a specific event by ID from a remote server.
    pub async fn fetch_event(
        &self,
        federation_endpoint: &str,
        event_id: &str,
        read_token: Option<&str>,
    ) -> Result<FederationEventEnvelope, FederationError> {
        let url = format!(
            "{}/event/{}",
            federation_endpoint.trim_end_matches('/'),
            event_id
        );
        let mut extra_headers: Vec<(&str, String)> = Vec::new();
        if let Some(token) = read_token {
            extra_headers.push(("x-paracord-federation-token", token.to_string()));
        }
        let resp = self
            .get_with_retry_with_headers(&url, &extra_headers)
            .await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid event response: {e}")))
    }

    /// Fetch messages/events from a remote server for a given room, paginated.
    pub async fn fetch_messages(
        &self,
        federation_endpoint: &str,
        room_id: &str,
        since_depth: i64,
        limit: i64,
    ) -> Result<Vec<FederationEventEnvelope>, FederationError> {
        let url = format!(
            "{}/events?room_id={}&since_depth={}&limit={}",
            federation_endpoint.trim_end_matches('/'),
            room_id,
            since_depth,
            limit
        );
        let resp = self.get_with_retry_with_headers(&url, &[]).await?;
        let events: FederationEventsResponse = resp
            .json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid events response: {e}")))?;
        Ok(events.events)
    }

    pub async fn send_invite(
        &self,
        federation_endpoint: &str,
        payload: &FederationInviteRequest,
    ) -> Result<FederationInviteResponse, FederationError> {
        let url = format!("{}/invite", federation_endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(payload).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body).await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid invite response: {e}")))
    }

    pub async fn send_join(
        &self,
        federation_endpoint: &str,
        payload: &FederationJoinRequest,
    ) -> Result<FederationJoinResponse, FederationError> {
        let url = format!("{}/join", federation_endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(payload).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body).await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid join response: {e}")))
    }

    pub async fn send_leave(
        &self,
        federation_endpoint: &str,
        payload: &FederationLeaveRequest,
    ) -> Result<FederationLeaveResponse, FederationError> {
        let url = format!("{}/leave", federation_endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(payload).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body).await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid leave response: {e}")))
    }

    pub async fn request_media_token(
        &self,
        federation_endpoint: &str,
        payload: &FederationMediaTokenRequest,
    ) -> Result<FederationMediaTokenResponse, FederationError> {
        let url = format!("{}/media/token", federation_endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(payload).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body).await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid media token response: {e}")))
    }

    pub async fn relay_media_action(
        &self,
        federation_endpoint: &str,
        payload: &FederationMediaRelayRequest,
    ) -> Result<FederationMediaRelayResponse, FederationError> {
        let url = format!("{}/media/relay", federation_endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(payload).map_err(|e| FederationError::Http(e.to_string()))?;
        let resp = self.post_with_retry(&url, body).await?;
        resp.json()
            .await
            .map_err(|e| FederationError::RemoteError(format!("invalid media relay response: {e}")))
    }

    /// GET request with exponential backoff retry.
    async fn get_with_retry(&self, url: &str) -> Result<reqwest::Response, FederationError> {
        self.get_with_retry_with_headers(url, &[]).await
    }

    async fn get_with_retry_with_headers(
        &self,
        url: &str,
        extra_headers: &[(&str, String)],
    ) -> Result<reqwest::Response, FederationError> {
        let mut last_err = FederationError::Http("no attempts made".to_string());
        for attempt in 0..MAX_RETRIES {
            let path = transport::request_path_from_url(url);
            let mut request = self.http.get(url);
            request = self.with_transport_signature_headers(request, "GET", &path, &[]);
            for (key, value) in extra_headers {
                request = request.header(*key, value);
            }

            match request.send().await {
                Ok(resp) if resp.status().is_success() => return Ok(resp),
                Ok(resp) if resp.status().is_server_error() => {
                    last_err = FederationError::RemoteError(format!(
                        "server error {} from {}",
                        resp.status(),
                        url
                    ));
                }
                Ok(resp) => {
                    return Err(FederationError::RemoteError(format!(
                        "request to {} returned {}",
                        url,
                        resp.status()
                    )));
                }
                Err(e) => {
                    last_err = FederationError::Http(e.to_string());
                }
            }
            if attempt + 1 < MAX_RETRIES {
                let delay = RETRY_BASE_DELAY * 2u32.pow(attempt);
                tokio::time::sleep(delay).await;
            }
        }
        Err(last_err)
    }

    /// POST request with exponential backoff retry.
    async fn post_with_retry(
        &self,
        url: &str,
        body_bytes: Vec<u8>,
    ) -> Result<reqwest::Response, FederationError> {
        let mut last_err = FederationError::Http("no attempts made".to_string());
        for attempt in 0..MAX_RETRIES {
            let mut request = self
                .http
                .post(url)
                .header("content-type", "application/json")
                .body(body_bytes.clone());
            let path = transport::request_path_from_url(url);
            request = self.with_transport_signature_headers(request, "POST", &path, &body_bytes);

            match request.send().await {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 202 => {
                    return Ok(resp);
                }
                Ok(resp) if resp.status().is_server_error() => {
                    last_err = FederationError::RemoteError(format!(
                        "server error {} from {}",
                        resp.status(),
                        url
                    ));
                }
                Ok(resp) => {
                    return Err(FederationError::RemoteError(format!(
                        "request to {} returned {}",
                        url,
                        resp.status()
                    )));
                }
                Err(e) => {
                    last_err = FederationError::Http(e.to_string());
                }
            }
            if attempt + 1 < MAX_RETRIES {
                let delay = RETRY_BASE_DELAY * 2u32.pow(attempt);
                tokio::time::sleep(delay).await;
            }
        }
        Err(last_err)
    }

    fn with_transport_signature_headers(
        &self,
        request: reqwest::RequestBuilder,
        method: &str,
        path: &str,
        body_bytes: &[u8],
    ) -> reqwest::RequestBuilder {
        let Some(signer) = &self.transport_signer else {
            return request;
        };
        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        let canonical =
            transport::canonical_transport_bytes_with_body(method, path, timestamp_ms, body_bytes);
        let signature = signing::sign(&signer.signing_key, &canonical);
        request
            .header("X-Paracord-Origin", signer.origin.as_str())
            .header("X-Paracord-Key-Id", signer.key_id.as_str())
            .header("X-Paracord-Timestamp", timestamp_ms.to_string())
            .header("X-Paracord-Signature", signature)
    }
}

impl Default for FederationClient {
    fn default() -> Self {
        Self::new().expect("failed to create federation HTTP client")
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationKeysResponse {
    pub server_name: String,
    pub keys: Vec<FederationServerKey>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PostEventResponse {
    pub event_id: String,
    pub inserted: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FederationEventsResponse {
    events: Vec<FederationEventEnvelope>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationInviteRequest {
    pub origin_server: String,
    pub room_id: String,
    pub sender: String,
    pub max_age_seconds: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationJoinRequest {
    pub origin_server: String,
    pub room_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationLeaveRequest {
    pub origin_server: String,
    pub room_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationMediaTokenRequest {
    pub origin_server: String,
    pub channel_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationMediaRelayRequest {
    pub origin_server: String,
    pub channel_id: String,
    pub user_id: String,
    pub action: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationInviteResponse {
    pub accepted: bool,
    pub room_id: String,
    pub guild_id: String,
    pub guild_name: String,
    pub default_channel_id: Option<String>,
    pub join_endpoint: String,
    pub expires_in_seconds: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationJoinResponse {
    pub joined: bool,
    pub room_id: String,
    pub guild_id: String,
    pub local_user_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationLeaveResponse {
    pub left: bool,
    pub room_id: String,
    pub guild_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationMediaTokenResponse {
    pub token: String,
    pub url: String,
    pub room_name: String,
    pub session_id: String,
    pub local_user_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FederationMediaRelayResponse {
    pub ok: bool,
    pub action: String,
    pub token: Option<String>,
    pub room_name: Option<String>,
    pub url: Option<String>,
}
