use std::collections::HashMap;
use std::time::Duration;

use tokio::time::interval;

use paracord_transport::control::ControlMessage;

use super::session::NativeMediaSession;

/// Spawn a task that periodically checks audio levels and emits speaking change events.
pub fn spawn_speaking_detector(session: &mut NativeMediaSession, app: tauri::AppHandle) {
    let shutdown = session.shutdown.clone();
    let remote_audio = session.remote_audio.clone();

    let handle = tokio::spawn(async move {
        use tauri::Emitter;

        let mut tick = interval(Duration::from_millis(100));
        let mut prev_speaking: HashMap<u32, bool> = HashMap::new();

        loop {
            tokio::select! {
                _ = shutdown.notified() => break,
                _ = tick.tick() => {
                    let remote = remote_audio.lock().await;
                    let mut speakers: HashMap<String, f64> = HashMap::new();
                    let mut changed = false;

                    for (&ssrc, state) in remote.iter() {
                        let is_speaking = state.audio_level < 100;
                        let level = 1.0 - (state.audio_level as f64 / 127.0);

                        let was_speaking = prev_speaking.get(&ssrc).copied().unwrap_or(false);
                        if is_speaking != was_speaking {
                            changed = true;
                        }
                        prev_speaking.insert(ssrc, is_speaking);

                        if is_speaking {
                            speakers.insert(ssrc.to_string(), level);
                        }
                    }

                    if changed || !speakers.is_empty() {
                        let _ = app.emit("media_speaking_change", &speakers);
                    }
                }
            }
        }
    });

    session.speaking_task = Some(handle);
}

/// Announce our sender key to the relay via the control stream.
pub async fn announce_sender_key(session: &NativeMediaSession) {
    let msg = ControlMessage::KeyAnnounce {
        epoch: session.key_epoch,
        encrypted_keys: vec![],
    };

    match session.connection.open_bi().await {
        Ok((mut send, _recv)) => {
            if let Ok(encoded) = msg.encode() {
                let _ = send.write_all(&encoded).await;
            }
        }
        Err(e) => {
            tracing::warn!("failed to open control stream for key announce: {e}");
        }
    }
}

/// Emit a participant join event.
#[allow(dead_code)]
pub fn emit_participant_join(app: &tauri::AppHandle, user_id: &str) {
    use tauri::Emitter;
    let _ = app.emit("media_participant_join", user_id);
}

/// Emit a participant leave event.
#[allow(dead_code)]
pub fn emit_participant_leave(app: &tauri::AppHandle, user_id: &str) {
    use tauri::Emitter;
    let _ = app.emit("media_participant_leave", user_id);
}

/// Emit a session error event.
#[allow(dead_code)]
pub fn emit_session_error(app: &tauri::AppHandle, error: &str) {
    use tauri::Emitter;
    let _ = app.emit("media_session_error", error);
}
