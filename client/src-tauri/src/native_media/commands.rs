use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::State;

use super::MediaState;

#[derive(Serialize)]
pub struct VoiceSessionInfo {
    pub session_id: String,
    pub connected: bool,
}

#[derive(Serialize)]
pub struct FileTransferResult {
    pub transfer_id: String,
    pub attachment_id: Option<String>,
    pub url: Option<String>,
    pub success: bool,
}

// ── Voice session lifecycle ──────────────────────────────────────────────────

#[tauri::command]
pub async fn start_voice_session(
    endpoint: String,
    token: String,
    room_id: String,
    state: State<'_, MediaState>,
    app: tauri::AppHandle,
) -> Result<VoiceSessionInfo, String> {
    use super::session::NativeMediaSession;
    use super::{audio_pipeline, events};

    let mut session = NativeMediaSession::connect(&endpoint, &token, &room_id).await?;
    let session_id = session.session_id.clone();

    // Spawn audio pipeline tasks
    audio_pipeline::spawn_audio_send_task(&mut session);
    audio_pipeline::spawn_datagram_recv_task(&mut session, app.clone());
    audio_pipeline::spawn_playout_task(&mut session);

    // Spawn event tasks
    events::spawn_speaking_detector(&mut session, app.clone());

    // Announce E2EE key via control stream
    events::announce_sender_key(&session).await;

    // Store the session
    let mut guard = state.session.lock().await;
    *guard = Some(session);

    Ok(VoiceSessionInfo {
        session_id,
        connected: true,
    })
}

#[tauri::command]
pub async fn stop_voice_session(state: State<'_, MediaState>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    if let Some(mut session) = guard.take() {
        session.disconnect().await;
    }
    Ok(())
}

// ── Mute / deaf / device switching ──────────────────────────────────────────

#[tauri::command]
pub async fn voice_set_mute(muted: bool, state: State<'_, MediaState>) -> Result<(), String> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("no active session")?;
    session
        .muted
        .store(muted, std::sync::atomic::Ordering::SeqCst);

    // When muting, stop capture to save CPU; when unmuting, restart
    drop(guard);
    // Note: capture start/stop handled by the send task checking the muted flag
    Ok(())
}

#[tauri::command]
pub async fn voice_set_deaf(deafened: bool, state: State<'_, MediaState>) -> Result<(), String> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("no active session")?;
    session
        .deafened
        .store(deafened, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn voice_switch_input_device(
    device_id: String,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    use paracord_codec::audio::capture::AudioCapture;

    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;

    // Stop existing capture
    if let Some(old) = session.audio_capture.take() {
        old.stop();
    }

    // Start capture on new device
    let index: usize = device_id
        .parse()
        .map_err(|_| "invalid device index".to_string())?;
    let (capture, rx) =
        AudioCapture::start_device(index).map_err(|e| format!("capture device: {e}"))?;
    session.audio_capture = Some(capture);
    session.pcm_rx = Some(rx);

    Ok(())
}

#[tauri::command]
pub async fn voice_switch_output_device(
    device_id: String,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    // AudioPlayback doesn't support runtime device switching yet.
    // We'd need to make start_from_device public (Task 12) and
    // rebuild the playback with all existing sources.
    let _ = device_id;
    let _ = state;
    Err("output device switching not yet implemented".into())
}

// ── Video commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn voice_enable_video(enabled: bool, state: State<'_, MediaState>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;
    super::video_pipeline::set_video_enabled(session, enabled)
}

#[tauri::command]
pub async fn voice_start_screen_share(state: State<'_, MediaState>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;
    super::video_pipeline::start_screen_share(session)
}

#[tauri::command]
pub async fn voice_stop_screen_share(state: State<'_, MediaState>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;
    super::video_pipeline::stop_screen_share(session);
    session.screen_audio_enabled.store(false, Ordering::SeqCst);
    Ok(())
}

/// Parse a binary frame payload: `[width:u32 LE][height:u32 LE][RGBA bytes…]`
fn parse_frame_payload<'a>(request: &'a tauri::ipc::Request<'a>) -> Result<(u32, u32, &'a [u8]), String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => return Err("expected binary frame data".into()),
    };
    if body.len() < 8 {
        return Err("frame payload too short".into());
    }
    let width = u32::from_le_bytes(body[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(body[4..8].try_into().unwrap());
    Ok((width, height, &body[8..]))
}

#[tauri::command]
pub async fn voice_push_video_frame(
    request: tauri::ipc::Request<'_>,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    let (width, height, rgba) = parse_frame_payload(&request)?;
    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;
    super::video_pipeline::encode_and_send_video_frame(session, width, height, rgba, false)
}

#[tauri::command]
pub async fn voice_push_screen_frame(
    request: tauri::ipc::Request<'_>,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    let (width, height, rgba) = parse_frame_payload(&request)?;
    let mut guard = state.session.lock().await;
    let session = guard.as_mut().ok_or("no active session")?;
    super::video_pipeline::encode_and_send_video_frame(session, width, height, rgba, true)
}

#[tauri::command]
pub async fn voice_set_screen_audio_enabled(
    enabled: bool,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("no active session")?;
    session
        .screen_audio_enabled
        .store(enabled, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn voice_push_screen_audio_frame(
    samples: Vec<f32>,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    if samples.is_empty() {
        return Ok(());
    }

    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("no active session")?;
    if !session.screen_audio_enabled.load(Ordering::SeqCst) {
        return Ok(());
    }

    let _ = session.screen_audio_tx.try_send(samples);
    Ok(())
}

#[tauri::command]
pub async fn media_subscribe_video(
    user_id: String,
    canvas_width: u32,
    canvas_height: u32,
    state: State<'_, MediaState>,
) -> Result<(), String> {
    // Send Subscribe control message to relay
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("no active session")?;
    let _ = (user_id, canvas_width, canvas_height, session);
    // TODO: send ControlMessage::Subscribe via control stream
    Ok(())
}

// ── File transfer ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn quic_upload_file(
    endpoint: String,
    token: String,
    transfer_id: String,
    file_path: String,
    app: tauri::AppHandle,
) -> Result<FileTransferResult, String> {
    super::file_transfer::upload_file(&endpoint, &token, &transfer_id, &file_path, app).await
}

#[tauri::command]
pub async fn quic_download_file(
    endpoint: String,
    token: String,
    attachment_id: String,
    dest_path: String,
    app: tauri::AppHandle,
) -> Result<FileTransferResult, String> {
    super::file_transfer::download_file(&endpoint, &token, &attachment_id, &dest_path, app).await
}
