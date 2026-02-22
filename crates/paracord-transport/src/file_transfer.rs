//! QUIC file transfer handler.
//!
//! Manages upload and download streams over QUIC bidirectional connections,
//! with support for resumable uploads via partial temp files.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use dashmap::DashMap;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncWriteExt};
use tracing;

use crate::control::{ControlMessage, StreamFrame, StreamFrameCodec, StreamFrameError};

/// Default chunk size for file transfer data frames (256 KiB).
pub const DEFAULT_CHUNK_SIZE: u32 = 256 * 1024;

/// Progress ACK interval in bytes (~1 MiB).
pub const PROGRESS_ACK_INTERVAL: u64 = 1024 * 1024;

/// Maximum file size for QUIC transfer (1 GiB).
pub const MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024;

/// JWT claims for file transfer upload tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransferClaims {
    /// User ID.
    pub sub: i64,
    /// Transfer ID.
    pub tid: String,
    /// Channel ID.
    pub cid: i64,
    /// Original filename.
    pub fname: String,
    /// File size in bytes.
    pub fsize: u64,
    /// Expiry timestamp.
    pub exp: usize,
    /// Issued at timestamp.
    pub iat: usize,
}

/// Validates a file transfer JWT token.
pub fn validate_file_transfer_token(
    token: &str,
    jwt_secret: &str,
) -> Result<FileTransferClaims, FileTransferError> {
    let validation = Validation::new(Algorithm::HS256);
    let token_data = decode::<FileTransferClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|e| FileTransferError::AuthFailed(e.to_string()))?;
    Ok(token_data.claims)
}

/// Tracks an in-progress file transfer.
#[derive(Debug)]
pub struct TransferState {
    pub transfer_id: String,
    pub user_id: i64,
    pub channel_id: i64,
    pub filename: String,
    pub total_size: u64,
    pub bytes_received: u64,
    pub temp_path: PathBuf,
    pub cancelled: bool,
}

/// Manages in-progress transfers for progress tracking, cancellation, and resume.
pub struct TransferTracker {
    transfers: DashMap<String, TransferState>,
}

impl TransferTracker {
    pub fn new() -> Self {
        Self {
            transfers: DashMap::new(),
        }
    }

    pub fn insert(&self, state: TransferState) {
        self.transfers.insert(state.transfer_id.clone(), state);
    }

    pub fn get_bytes_received(&self, transfer_id: &str) -> Option<u64> {
        self.transfers.get(transfer_id).map(|s| s.bytes_received)
    }

    pub fn update_bytes_received(&self, transfer_id: &str, bytes: u64) {
        if let Some(mut state) = self.transfers.get_mut(transfer_id) {
            state.bytes_received = bytes;
        }
    }

    pub fn cancel(&self, transfer_id: &str) -> bool {
        if let Some(mut state) = self.transfers.get_mut(transfer_id) {
            state.cancelled = true;
            true
        } else {
            false
        }
    }

    pub fn is_cancelled(&self, transfer_id: &str) -> bool {
        self.transfers
            .get(transfer_id)
            .map(|s| s.cancelled)
            .unwrap_or(false)
    }

    pub fn remove(&self, transfer_id: &str) -> Option<TransferState> {
        self.transfers.remove(transfer_id).map(|(_, v)| v)
    }
}

impl Default for TransferTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Manages partial upload temp files for resume support.
pub struct PartialUploadManager {
    partial_dir: PathBuf,
}

impl PartialUploadManager {
    pub fn new(storage_path: &str) -> Self {
        let partial_dir = Path::new(storage_path).join("partial");
        Self { partial_dir }
    }

    /// Ensure the partial directory exists.
    pub async fn ensure_dir(&self) -> Result<(), FileTransferError> {
        tokio::fs::create_dir_all(&self.partial_dir)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
        Ok(())
    }

    /// Get the temp file path for a transfer.
    pub fn temp_path(&self, transfer_id: &str) -> PathBuf {
        self.partial_dir.join(format!("{}.part", transfer_id))
    }

    /// Get the current size of a partial upload (for resume).
    pub async fn get_partial_size(&self, transfer_id: &str) -> u64 {
        let path = self.temp_path(transfer_id);
        match tokio::fs::metadata(&path).await {
            Ok(meta) => meta.len(),
            Err(_) => 0,
        }
    }

    /// Create or open a temp file for writing (append mode for resume).
    pub async fn open_for_append(
        &self,
        transfer_id: &str,
    ) -> Result<tokio::fs::File, FileTransferError> {
        let path = self.temp_path(transfer_id);
        tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))
    }

    /// Read the complete temp file contents.
    pub async fn read_complete(&self, transfer_id: &str) -> Result<Vec<u8>, FileTransferError> {
        let path = self.temp_path(transfer_id);
        tokio::fs::read(&path)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))
    }

    /// Remove a temp file.
    pub async fn remove(&self, transfer_id: &str) {
        let path = self.temp_path(transfer_id);
        let _ = tokio::fs::remove_file(&path).await;
    }

    /// Truncate a partial file to a specific size (for resume correction).
    pub async fn truncate_to(
        &self,
        transfer_id: &str,
        size: u64,
    ) -> Result<(), FileTransferError> {
        let path = self.temp_path(transfer_id);
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
        file.set_len(size)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
        Ok(())
    }

    /// Spawn a background task that cleans up partial files older than 1 hour.
    pub fn spawn_cleanup_task(
        partial_dir: PathBuf,
        shutdown: Arc<tokio::sync::Notify>,
    ) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = shutdown.notified() => break,
                    _ = interval.tick() => {
                        if let Err(e) = cleanup_old_partials(&partial_dir, Duration::from_secs(3600)).await {
                            tracing::warn!("Partial upload cleanup error: {}", e);
                        }
                    }
                }
            }
        });
    }
}

async fn cleanup_old_partials(dir: &Path, max_age: Duration) -> Result<(), std::io::Error> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("part") {
            if let Ok(meta) = tokio::fs::metadata(&path).await {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = modified.elapsed() {
                        if age > max_age {
                            tracing::info!("Removing stale partial upload: {:?}", path);
                            let _ = tokio::fs::remove_file(&path).await;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum FileTransferError {
    #[error("authentication failed: {0}")]
    AuthFailed(String),
    #[error("transfer rejected: {0}")]
    Rejected(String),
    #[error("transfer cancelled")]
    Cancelled,
    #[error("file too large: {size} bytes (max {MAX_FILE_SIZE})")]
    FileTooLarge { size: u64 },
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("stream frame error: {0}")]
    Frame(#[from] StreamFrameError),
}

/// Handle an incoming upload stream.
///
/// Reads FileTransferInit, validates the token, streams data chunks to a temp
/// file, sends periodic progress ACKs, and returns the completed file data.
pub async fn handle_upload_stream(
    send: &mut quinn::SendStream,
    recv: &mut quinn::RecvStream,
    jwt_secret: &str,
    tracker: &TransferTracker,
    partial_mgr: &PartialUploadManager,
) -> Result<UploadResult, FileTransferError> {
    let mut codec = StreamFrameCodec::new();
    let mut buf = vec![0u8; 32 * 1024];

    // 1. Read the init message
    let init_msg = read_next_control(recv, &mut codec, &mut buf).await?;
    let (transfer_id, upload_token, resume_offset) = match init_msg {
        ControlMessage::FileTransferInit {
            transfer_id,
            upload_token,
            resume_offset,
        } => (transfer_id, upload_token, resume_offset),
        _ => {
            return Err(FileTransferError::Protocol(
                "expected FileTransferInit".into(),
            ))
        }
    };

    // 2. Validate the upload token
    let claims = validate_file_transfer_token(&upload_token, jwt_secret)?;
    if claims.tid != transfer_id {
        return Err(FileTransferError::Protocol("transfer_id mismatch".into()));
    }
    if claims.fsize > MAX_FILE_SIZE {
        let reject = StreamFrame::Control(ControlMessage::FileTransferReject {
            transfer_id: transfer_id.clone(),
            reason: "file too large".into(),
        });
        let _ = send.write_all(&reject.encode()?).await;
        return Err(FileTransferError::FileTooLarge { size: claims.fsize });
    }

    // 3. Handle resume
    partial_mgr.ensure_dir().await?;
    let existing_size = partial_mgr.get_partial_size(&transfer_id).await;
    let resume_from = if let Some(requested_offset) = resume_offset {
        // Client wants to resume - use the minimum of what they think and what we have
        let confirmed = requested_offset.min(existing_size);
        if confirmed < existing_size {
            partial_mgr.truncate_to(&transfer_id, confirmed).await?;
        }
        confirmed
    } else {
        // Fresh upload - remove any stale partial
        if existing_size > 0 {
            partial_mgr.remove(&transfer_id).await;
        }
        0
    };

    // 4. Send accept
    let accept = StreamFrame::Control(ControlMessage::FileTransferAccept {
        transfer_id: transfer_id.clone(),
        chunk_size: DEFAULT_CHUNK_SIZE,
        offset: resume_from,
    });
    send.write_all(&accept.encode()?)
        .await
        .map_err(|e| FileTransferError::Io(e.to_string()))?;

    // 5. Register transfer
    let transfer_state = TransferState {
        transfer_id: transfer_id.clone(),
        user_id: claims.sub,
        channel_id: claims.cid,
        filename: claims.fname.clone(),
        total_size: claims.fsize,
        bytes_received: resume_from,
        temp_path: partial_mgr.temp_path(&transfer_id),
        cancelled: false,
    };
    tracker.insert(transfer_state);

    // 6. Open temp file for writing
    let mut file = partial_mgr.open_for_append(&transfer_id).await?;
    let mut bytes_received = resume_from;
    let mut last_ack_at = bytes_received;

    // 7. Read data chunks until EndOfData
    loop {
        if tracker.is_cancelled(&transfer_id) {
            let cancel = StreamFrame::Control(ControlMessage::FileTransferCancel {
                transfer_id: transfer_id.clone(),
            });
            let _ = send.write_all(&cancel.encode()?).await;
            tracker.remove(&transfer_id);
            partial_mgr.remove(&transfer_id).await;
            return Err(FileTransferError::Cancelled);
        }

        let n = recv
            .read(&mut buf)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
        let Some(n) = n else {
            // Stream closed unexpectedly - keep partial for resume
            tracker.remove(&transfer_id);
            return Err(FileTransferError::Io("stream closed unexpectedly".into()));
        };
        codec.feed(&buf[..n]);

        while let Some(frame) = codec.decode_next()? {
            match frame {
                StreamFrame::Data(data) => {
                    if bytes_received + data.len() as u64 > claims.fsize {
                        let err_msg = StreamFrame::Control(ControlMessage::FileTransferError {
                            transfer_id: transfer_id.clone(),
                            code: 1,
                            message: "received more data than declared file size".into(),
                        });
                        let _ = send.write_all(&err_msg.encode()?).await;
                        tracker.remove(&transfer_id);
                        partial_mgr.remove(&transfer_id).await;
                        return Err(FileTransferError::Protocol(
                            "data exceeds declared size".into(),
                        ));
                    }

                    file.write_all(&data)
                        .await
                        .map_err(|e| FileTransferError::Io(e.to_string()))?;
                    bytes_received += data.len() as u64;
                    tracker.update_bytes_received(&transfer_id, bytes_received);

                    // Send progress ACK every ~1MB
                    if bytes_received - last_ack_at >= PROGRESS_ACK_INTERVAL {
                        let progress =
                            StreamFrame::Control(ControlMessage::FileTransferProgress {
                                transfer_id: transfer_id.clone(),
                                bytes_received,
                            });
                        send.write_all(&progress.encode()?)
                            .await
                            .map_err(|e| FileTransferError::Io(e.to_string()))?;
                        last_ack_at = bytes_received;
                    }
                }
                StreamFrame::EndOfData => {
                    file.flush()
                        .await
                        .map_err(|e| FileTransferError::Io(e.to_string()))?;
                    drop(file);

                    let data = partial_mgr.read_complete(&transfer_id).await?;
                    partial_mgr.remove(&transfer_id).await;
                    tracker.remove(&transfer_id);

                    return Ok(UploadResult {
                        transfer_id,
                        user_id: claims.sub,
                        channel_id: claims.cid,
                        filename: claims.fname,
                        content_type: None, // Will be resolved by the caller
                        data,
                    });
                }
                StreamFrame::Control(ControlMessage::FileTransferCancel { .. }) => {
                    tracker.remove(&transfer_id);
                    partial_mgr.remove(&transfer_id).await;
                    return Err(FileTransferError::Cancelled);
                }
                _ => {
                    // Ignore unexpected control messages
                }
            }
        }
    }
}

/// Result of a successful upload.
pub struct UploadResult {
    pub transfer_id: String,
    pub user_id: i64,
    pub channel_id: i64,
    pub filename: String,
    pub content_type: Option<String>,
    pub data: Vec<u8>,
}

/// Handle an incoming download stream.
///
/// Reads FileDownloadRequest, validates auth, streams the file data back.
pub async fn handle_download_stream(
    send: &mut quinn::SendStream,
    recv: &mut quinn::RecvStream,
    _jwt_secret: &str,
    file_data: &[u8],
    filename: &str,
    content_type: &str,
    attachment_id: &str,
) -> Result<(), FileTransferError> {
    let mut codec = StreamFrameCodec::new();
    let mut buf = vec![0u8; 32 * 1024];

    // 1. Read download request
    let req_msg = read_next_control(recv, &mut codec, &mut buf).await?;
    let (req_attachment_id, _auth_token, range_start) = match req_msg {
        ControlMessage::FileDownloadRequest {
            attachment_id,
            auth_token,
            range_start,
            ..
        } => (attachment_id, auth_token, range_start),
        _ => {
            return Err(FileTransferError::Protocol(
                "expected FileDownloadRequest".into(),
            ))
        }
    };

    let offset = range_start.unwrap_or(0) as usize;
    let data_to_send = if offset < file_data.len() {
        &file_data[offset..]
    } else {
        &[]
    };

    // 2. Send accept
    let accept = StreamFrame::Control(ControlMessage::FileDownloadAccept {
        attachment_id: req_attachment_id.clone(),
        filename: filename.to_string(),
        size: data_to_send.len() as u64,
        content_type: content_type.to_string(),
        offset: offset as u64,
    });
    send.write_all(&accept.encode()?)
        .await
        .map_err(|e| FileTransferError::Io(e.to_string()))?;

    // 3. Send data in chunks
    let chunk_size = DEFAULT_CHUNK_SIZE as usize;
    for chunk in data_to_send.chunks(chunk_size) {
        let frame = StreamFrame::Data(Bytes::copy_from_slice(chunk));
        send.write_all(&frame.encode()?)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
    }

    // 4. Send end of data
    let end = StreamFrame::EndOfData;
    send.write_all(&end.encode()?)
        .await
        .map_err(|e| FileTransferError::Io(e.to_string()))?;

    // 5. Send done
    let done = StreamFrame::Control(ControlMessage::FileTransferDone {
        transfer_id: req_attachment_id.clone(),
        attachment_id: Some(attachment_id.to_string()),
        url: None,
    });
    send.write_all(&done.encode()?)
        .await
        .map_err(|e| FileTransferError::Io(e.to_string()))?;

    Ok(())
}

/// Helper to read the next control message from a stream.
async fn read_next_control(
    recv: &mut quinn::RecvStream,
    codec: &mut StreamFrameCodec,
    buf: &mut [u8],
) -> Result<ControlMessage, FileTransferError> {
    loop {
        // Try to decode from existing buffer first
        if let Some(frame) = codec.decode_next()? {
            match frame {
                StreamFrame::Control(msg) => return Ok(msg),
                _ => continue, // skip non-control frames
            }
        }

        // Read more data
        let n = recv
            .read(buf)
            .await
            .map_err(|e| FileTransferError::Io(e.to_string()))?;
        let Some(n) = n else {
            return Err(FileTransferError::Io("stream closed".into()));
        };
        codec.feed(&buf[..n]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_transfer_claims_roundtrip() {
        let claims = FileTransferClaims {
            sub: 12345,
            tid: "transfer-1".to_string(),
            cid: 67890,
            fname: "photo.png".to_string(),
            fsize: 4096000,
            exp: 9999999999,
            iat: 1000000000,
        };
        let json = serde_json::to_string(&claims).unwrap();
        let parsed: FileTransferClaims = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.sub, 12345);
        assert_eq!(parsed.tid, "transfer-1");
        assert_eq!(parsed.cid, 67890);
        assert_eq!(parsed.fname, "photo.png");
        assert_eq!(parsed.fsize, 4096000);
    }

    #[test]
    fn transfer_tracker_basic_ops() {
        let tracker = TransferTracker::new();
        let state = TransferState {
            transfer_id: "t1".into(),
            user_id: 1,
            channel_id: 2,
            filename: "test.txt".into(),
            total_size: 1000,
            bytes_received: 0,
            temp_path: PathBuf::from("/tmp/t1.part"),
            cancelled: false,
        };
        tracker.insert(state);
        assert_eq!(tracker.get_bytes_received("t1"), Some(0));

        tracker.update_bytes_received("t1", 500);
        assert_eq!(tracker.get_bytes_received("t1"), Some(500));

        assert!(!tracker.is_cancelled("t1"));
        assert!(tracker.cancel("t1"));
        assert!(tracker.is_cancelled("t1"));

        let removed = tracker.remove("t1");
        assert!(removed.is_some());
        assert_eq!(tracker.get_bytes_received("t1"), None);
    }

    #[tokio::test]
    async fn partial_upload_manager_temp_path() {
        let mgr = PartialUploadManager::new("/tmp/test-storage");
        let path = mgr.temp_path("transfer-123");
        assert!(path.to_str().unwrap().contains("partial"));
        assert!(path.to_str().unwrap().contains("transfer-123.part"));
    }
}
