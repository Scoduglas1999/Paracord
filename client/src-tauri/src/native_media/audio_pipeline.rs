use std::sync::atomic::Ordering;
use std::time::Instant;

use bytes::{BufMut, BytesMut};
use tokio::time::{interval, Duration};

use paracord_codec::audio::opus::FRAME_SIZE;
use paracord_transport::protocol::{MediaHeader, TrackType, HEADER_SIZE};

use super::session::NativeMediaSession;

/// Spawn the audio send task: captures mic → noise suppress → Opus encode → encrypt → QUIC datagram.
pub fn spawn_audio_send_task(session: &mut NativeMediaSession) {
    let muted = session.muted.clone();
    let shutdown = session.shutdown.clone();
    let local_ssrc = session.local_ssrc;

    // Take ownership of the PCM receiver — it moves into the task
    let Some(mut pcm_rx) = session.pcm_rx.take() else {
        return;
    };

    let conn_inner = session.connection.inner().clone();
    let key_epoch = session.key_epoch;
    let sender_key = session.sender_key;

    let handle = tokio::spawn(async move {
        // Per-task codec instances (avoids borrowing from session across await)
        let mut opus_encoder = match paracord_codec::audio::opus::OpusEncoder::new() {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("audio send task: opus encoder init failed: {e}");
                return;
            }
        };
        let mut noise_suppressor = paracord_codec::audio::noise::NoiseSuppressor::new();
        let mut frame_encryptor = paracord_codec::crypto::FrameEncryptor::new();
        frame_encryptor.set_key(key_epoch, &sender_key);

        let mut seq: u16 = 0;
        let mut timestamp: u32 = 0;

        loop {
            tokio::select! {
                _ = shutdown.notified() => break,
                frame = pcm_rx.recv() => {
                    let Some(pcm) = frame else { break };

                    // Skip encoding if muted
                    if muted.load(Ordering::SeqCst) {
                        continue;
                    }

                    // Noise suppression
                    let denoised = noise_suppressor.process_frame(&pcm);

                    // Compute audio level (RMS → dBov approximation)
                    let audio_level = compute_audio_level(&denoised);

                    // Opus encode
                    let opus_data = match opus_encoder.encode(&denoised) {
                        Ok(data) => data,
                        Err(e) => {
                            tracing::warn!("opus encode error: {e}");
                            continue;
                        }
                    };

                    // Build header
                    let mut header = MediaHeader::new(TrackType::Audio, local_ssrc);
                    header.sequence = seq;
                    header.timestamp = timestamp;
                    header.audio_level = audio_level;
                    header.key_epoch = key_epoch;

                    // Serialize header for AAD
                    let mut header_buf = BytesMut::with_capacity(HEADER_SIZE);
                    header.encode(&mut header_buf);
                    let header_bytes: [u8; HEADER_SIZE] = header_buf[..HEADER_SIZE]
                        .try_into()
                        .expect("header is 16 bytes");

                    // Encrypt
                    let encrypted = match frame_encryptor.encrypt(
                        &header_bytes,
                        local_ssrc,
                        key_epoch,
                        seq,
                        &opus_data,
                    ) {
                        Ok(data) => data,
                        Err(e) => {
                            tracing::warn!("encrypt error: {e:?}");
                            continue;
                        }
                    };

                    // Build final datagram: header (with correct payload_length) + encrypted payload
                    header.payload_length = encrypted.len() as u16;
                    let mut buf = BytesMut::with_capacity(HEADER_SIZE + encrypted.len());
                    header.encode(&mut buf);
                    buf.put_slice(&encrypted);

                    if let Err(e) = conn_inner.send_datagram(buf.freeze()) {
                        tracing::warn!("datagram send error: {e}");
                        break;
                    }

                    seq = seq.wrapping_add(1);
                    timestamp = timestamp.wrapping_add(FRAME_SIZE as u32);
                }
            }
        }
    });

    session.audio_send_task = Some(handle);
}

/// Spawn the datagram receive task: QUIC datagram → parse header → decrypt → dispatch audio/video.
pub fn spawn_datagram_recv_task(session: &mut NativeMediaSession, app: tauri::AppHandle) {
    let shutdown = session.shutdown.clone();
    let remote_audio = session.remote_audio.clone();
    let deafened = session.deafened.clone();
    let conn_inner = session.connection.inner().clone();
    let key_epoch = session.key_epoch;
    let sender_key = session.sender_key;

    let handle = tokio::spawn(async move {
        let mut frame_decryptor = paracord_codec::crypto::FrameDecryptor::new();
        // Seed with our own key for initial testing; remote keys arrive via KeyDeliver.
        frame_decryptor.set_key(key_epoch, &sender_key);

        let start_time = Instant::now();

        loop {
            tokio::select! {
                _ = shutdown.notified() => break,
                result = conn_inner.read_datagram() => {
                    let data = match result {
                        Ok(data) => data,
                        Err(_) => break,
                    };

                    if data.len() < HEADER_SIZE {
                        continue;
                    }

                    let mut cursor = &data[..];
                    let header = match MediaHeader::decode(&mut cursor) {
                        Ok(h) => h,
                        Err(_) => continue,
                    };

                    let payload = &data[HEADER_SIZE..];

                    // Decrypt
                    let header_bytes: [u8; HEADER_SIZE] = data[..HEADER_SIZE]
                        .try_into()
                        .expect("header is 16 bytes");

                    let decrypted = match frame_decryptor.decrypt(
                        &header_bytes,
                        header.ssrc,
                        header.key_epoch,
                        header.sequence,
                        payload,
                    ) {
                        Ok(data) => data,
                        Err(_) => continue,
                    };

                    match header.track_type {
                        TrackType::Audio => {
                            if deafened.load(Ordering::SeqCst) {
                                continue;
                            }
                            let arrival_ms = start_time.elapsed().as_millis() as u64;
                            let mut remote = remote_audio.lock().await;
                            if let Some(state) = remote.get_mut(&header.ssrc) {
                                state.jitter_buffer.insert(
                                    header.sequence,
                                    header.timestamp,
                                    decrypted,
                                    arrival_ms,
                                );
                                state.audio_level = header.audio_level;
                            }
                            // New SSRCs are registered when add_playback_source
                            // is called from the playout/session setup code.
                        }
                        TrackType::Video => {
                            super::video_pipeline::handle_video_datagram(
                                &header,
                                &decrypted,
                                &app,
                            );
                        }
                    }
                }
            }
        }
    });

    session.datagram_recv_task = Some(handle);
}

/// Spawn the playout task: 20ms timer → pull from jitter buffers → Opus decode → send to playback mixer.
pub fn spawn_playout_task(session: &mut NativeMediaSession) {
    let shutdown = session.shutdown.clone();
    let deafened = session.deafened.clone();
    let remote_audio = session.remote_audio.clone();

    let handle = tokio::spawn(async move {
        let mut tick = interval(Duration::from_millis(20));

        loop {
            tokio::select! {
                _ = shutdown.notified() => break,
                _ = tick.tick() => {
                    if deafened.load(Ordering::SeqCst) {
                        continue;
                    }

                    let mut remote = remote_audio.lock().await;
                    for (_ssrc, state) in remote.iter_mut() {
                        let pcm = match state.jitter_buffer.pull() {
                            Some(opus_bytes) => {
                                match state.decoder.decode(&opus_bytes) {
                                    Ok(samples) => samples,
                                    Err(_) => state.decoder.decode_plc().unwrap_or_default(),
                                }
                            }
                            None => {
                                state.decoder.decode_plc().unwrap_or_default()
                            }
                        };

                        if !pcm.is_empty() {
                            let _ = state.playback_tx.try_send(pcm);
                        }
                    }
                }
            }
        }
    });

    session.playout_task = Some(handle);
}

/// Compute audio level from PCM samples.
/// Returns 0 (loudest) to 127 (silence) in dBov-like scale.
fn compute_audio_level(pcm: &[f32]) -> u8 {
    if pcm.is_empty() {
        return 127;
    }
    let rms: f32 = (pcm.iter().map(|s| s * s).sum::<f32>() / pcm.len() as f32).sqrt();
    if rms < 1e-10 {
        return 127;
    }
    let db = 20.0 * rms.log10();
    (-db).clamp(0.0, 127.0) as u8
}
