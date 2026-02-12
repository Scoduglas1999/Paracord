use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
pub struct AudioChunk {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

struct CaptureHandle {
    stop_flag: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

static CAPTURE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

#[tauri::command]
pub fn start_system_audio_capture(on_audio: Channel<AudioChunk>) -> Result<(), String> {
    let mut guard = CAPTURE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Audio capture already running".into());
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop = stop_flag.clone();

    let thread = thread::spawn(move || {
        if let Err(e) = capture_loop(&on_audio, &stop) {
            eprintln!("[audio_capture] Capture loop error: {e}");
        }
    });

    *guard = Some(CaptureHandle {
        stop_flag,
        thread: Some(thread),
    });

    Ok(())
}

#[tauri::command]
pub fn stop_system_audio_capture() -> Result<(), String> {
    let mut guard = CAPTURE.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = guard.take() {
        handle.stop_flag.store(true, Ordering::SeqCst);
        if let Some(thread) = handle.thread.take() {
            let _ = thread.join();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows: WASAPI loopback capture
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn capture_loop(
    channel: &Channel<AudioChunk>,
    stop_flag: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    wasapi::initialize_mta().ok()?;

    let enumerator = wasapi::DeviceEnumerator::new()?;
    let device = enumerator.get_default_device(&wasapi::Direction::Render)?;
    let mut audio_client = device.get_iaudioclient()?;
    let format = audio_client.get_mixformat()?;

    let sample_rate = format.get_samplespersec();
    let num_channels = format.get_nchannels() as usize;
    let block_align = format.get_blockalign() as usize;
    let bits_per_sample = format.get_bitspersample() as usize;
    let bytes_per_sample = bits_per_sample / 8;

    let (_default_period, min_period) = audio_client.get_device_period()?;

    let mode = wasapi::StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };
    audio_client.initialize_client(&format, &wasapi::Direction::Capture, &mode)?;

    let h_event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;

    let buffer_size_frames = audio_client.get_buffer_size()?;
    let buffer_size_bytes = buffer_size_frames as usize * block_align;
    let mut buffer = vec![0u8; buffer_size_bytes];

    audio_client.start_stream()?;

    eprintln!(
        "[audio_capture] Started WASAPI: {}Hz, {} ch, {} bits/sample",
        sample_rate, num_channels, bits_per_sample
    );

    while !stop_flag.load(Ordering::Relaxed) {
        if h_event.wait_for_event(100).is_err() {
            continue;
        }

        let (frames_read, _info) = match capture_client.read_from_device(&mut buffer) {
            Ok(result) => result,
            Err(e) => {
                eprintln!("[audio_capture] Read error: {e}");
                break;
            }
        };

        if frames_read == 0 {
            continue;
        }

        let data_bytes = frames_read as usize * block_align;
        let mono = interleaved_to_mono_f32(&buffer[..data_bytes], num_channels, bytes_per_sample);
        if !mono.is_empty() {
            let _ = channel.send(AudioChunk {
                samples: mono,
                sample_rate,
            });
        }
    }

    audio_client.stop_stream()?;
    eprintln!("[audio_capture] Stopped");
    Ok(())
}

// ---------------------------------------------------------------------------
// Linux: PulseAudio monitor source capture
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
fn capture_loop(
    channel: &Channel<AudioChunk>,
    stop_flag: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use libpulse_binding::sample::{Format, Spec};
    use libpulse_binding::stream::Direction;
    use libpulse_simple_binding::Simple;

    let sample_rate: u32 = 48000;
    let num_channels: u8 = 1;

    let spec = Spec {
        format: Format::F32le,
        channels: num_channels,
        rate: sample_rate,
    };

    if !spec.is_valid() {
        return Err("Invalid PulseAudio sample spec".into());
    }

    // @DEFAULT_MONITOR@ captures the default output sink's monitor source,
    // which provides system audio loopback.
    let pulse = Simple::new(
        None,                    // default server
        "Paracord",              // app name
        Direction::Record,       // recording
        Some("@DEFAULT_MONITOR@"), // monitor source for loopback
        "System Audio Capture",  // stream description
        &spec,
        None,                    // default channel map
        None,                    // default buffering attributes
    ).map_err(|e| format!("Failed to connect to PulseAudio: {e}"))?;

    // Read buffer: 20ms of mono f32 audio at 48kHz = 960 frames * 4 bytes = 3840 bytes
    let frames_per_chunk: usize = 960;
    let mut buffer = vec![0u8; frames_per_chunk * 4]; // f32 = 4 bytes

    eprintln!(
        "[audio_capture] Started PulseAudio: {}Hz, {} ch, f32",
        sample_rate, num_channels
    );

    while !stop_flag.load(Ordering::Relaxed) {
        if let Err(e) = pulse.read(&mut buffer) {
            eprintln!("[audio_capture] PulseAudio read error: {e}");
            break;
        }

        // Convert raw f32le bytes to Vec<f32>
        let samples: Vec<f32> = buffer
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();

        if !samples.is_empty() {
            let _ = channel.send(AudioChunk {
                samples,
                sample_rate,
            });
        }
    }

    eprintln!("[audio_capture] Stopped");
    Ok(())
}

// ---------------------------------------------------------------------------
// macOS: stub (not yet implemented)
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn capture_loop(
    _channel: &Channel<AudioChunk>,
    _stop_flag: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    Err("Native system audio capture is not yet supported on macOS. \
         Audio from screen shares will still work via browser APIs."
        .into())
}

// ---------------------------------------------------------------------------
// Fallback for other platforms
// ---------------------------------------------------------------------------
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn capture_loop(
    _channel: &Channel<AudioChunk>,
    _stop_flag: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    Err("System audio capture is not supported on this platform.".into())
}

/// Convert interleaved raw PCM bytes to a mono f32 vector by averaging all channels.
#[allow(dead_code)]
fn interleaved_to_mono_f32(data: &[u8], num_channels: usize, bytes_per_sample: usize) -> Vec<f32> {
    let frame_size = num_channels * bytes_per_sample;
    if frame_size == 0 {
        return Vec::new();
    }
    let num_frames = data.len() / frame_size;
    let mut mono = Vec::with_capacity(num_frames);

    for frame_idx in 0..num_frames {
        let frame_start = frame_idx * frame_size;
        let mut sum = 0.0f32;

        for ch in 0..num_channels {
            let offset = frame_start + ch * bytes_per_sample;
            let sample = match bytes_per_sample {
                // 32-bit IEEE float (most common for WASAPI shared mode)
                4 => f32::from_le_bytes([
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ]),
                // 16-bit signed integer
                2 => {
                    let s = i16::from_le_bytes([data[offset], data[offset + 1]]);
                    s as f32 / 32768.0
                }
                // 24-bit signed integer (packed)
                3 => {
                    let raw = (data[offset] as i32)
                        | ((data[offset + 1] as i32) << 8)
                        | ((data[offset + 2] as i32) << 16);
                    let signed = if raw & 0x80_0000 != 0 {
                        raw | !0xFF_FFFF
                    } else {
                        raw
                    };
                    signed as f32 / 8_388_608.0
                }
                _ => 0.0,
            };
            sum += sample;
        }

        mono.push(sum / num_channels as f32);
    }

    mono
}
