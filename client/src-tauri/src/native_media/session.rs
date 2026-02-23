use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;

use paracord_codec::audio::capture::AudioCapture;
use paracord_codec::audio::jitter::JitterBuffer;
use paracord_codec::audio::noise::NoiseSuppressor;
use paracord_codec::audio::opus::{OpusDecoder, OpusEncoder};
use paracord_codec::audio::playback::AudioPlayback;
use paracord_codec::crypto::{FrameDecryptor, FrameEncryptor};
use paracord_transport::connection::MediaConnection;
use paracord_transport::endpoint::MediaEndpoint;

/// Per-remote-participant audio state.
#[allow(dead_code)]
pub struct RemoteAudioState {
    pub decoder: OpusDecoder,
    pub jitter_buffer: JitterBuffer<Vec<u8>>,
    pub playback_tx: mpsc::Sender<Vec<f32>>,
    pub audio_level: u8,
}

/// Active native media session connected to the relay via QUIC.
#[allow(dead_code)]
pub struct NativeMediaSession {
    // QUIC transport
    pub endpoint: MediaEndpoint,
    pub connection: MediaConnection,

    // Audio capture
    pub audio_capture: Option<AudioCapture>,
    pub pcm_rx: Option<mpsc::Receiver<Vec<f32>>>,
    pub screen_audio_rx: Option<mpsc::Receiver<Vec<f32>>>,
    pub screen_audio_tx: mpsc::Sender<Vec<f32>>,
    pub screen_audio_enabled: Arc<AtomicBool>,

    // Audio playback
    pub audio_playback: AudioPlayback,

    // Opus codec
    pub opus_encoder: OpusEncoder,

    // Noise suppression
    pub noise_suppressor: NoiseSuppressor,

    // E2EE encryption/decryption
    pub frame_encryptor: FrameEncryptor,
    pub frame_decryptor: FrameDecryptor,
    pub key_epoch: u8,
    pub sender_key: [u8; 16],

    // Remote participants
    pub remote_audio: Arc<tokio::sync::Mutex<HashMap<u32, RemoteAudioState>>>,

    // Local identity
    pub local_ssrc: u32,
    pub session_id: String,

    // Mute/deaf controls
    pub muted: Arc<AtomicBool>,
    pub deafened: Arc<AtomicBool>,

    // Task management
    pub shutdown: Arc<Notify>,
    pub audio_send_task: Option<JoinHandle<()>>,
    pub datagram_recv_task: Option<JoinHandle<()>>,
    pub playout_task: Option<JoinHandle<()>>,
    pub speaking_task: Option<JoinHandle<()>>,
    pub control_recv_task: Option<JoinHandle<()>>,

    // Video encoders (optional, behind feature gate)
    #[cfg(feature = "vpx")]
    pub video_encoder: Option<Box<dyn paracord_codec::video::encoder::VideoEncoder>>,
    #[cfg(feature = "vpx")]
    pub screen_encoder: Option<Box<dyn paracord_codec::video::encoder::VideoEncoder>>,
    #[cfg(feature = "vpx")]
    pub video_decoders: HashMap<u32, Box<dyn paracord_codec::video::decoder::VideoDecoder>>,
    /// Reusable buffer for RGBA→I420 conversion before VP9 encoding.
    #[cfg(feature = "vpx")]
    pub i420_convert_buf: Vec<u8>,

    pub video_send_task: Option<JoinHandle<()>>,
    pub screen_send_task: Option<JoinHandle<()>>,

    pub video_ssrc: u32,
    pub screen_ssrc: u32,
    pub video_seq: u16,
    pub screen_seq: u16,
}

// SAFETY: NativeMediaSession is always accessed through a tokio::Mutex<Option<..>>
// which guarantees exclusive access. The !Send/!Sync inner types (cpal::Stream via
// AudioPlayback/AudioCapture, audiopus raw pointers in OpusEncoder/OpusDecoder,
// nnnoiseless DenoiseState) all hold independent per-instance state that is safe
// to move between threads.
unsafe impl Send for NativeMediaSession {}
unsafe impl Sync for NativeMediaSession {}

impl NativeMediaSession {
    async fn resolve_endpoint_addr(endpoint_addr: &str) -> Result<SocketAddr, String> {
        if let Ok(addr) = endpoint_addr.parse::<SocketAddr>() {
            return Ok(addr);
        }

        if let Ok(url) = url::Url::parse(endpoint_addr) {
            let host = url
                .host_str()
                .ok_or_else(|| format!("endpoint URL missing host: {endpoint_addr}"))?;
            let port = url
                .port_or_known_default()
                .ok_or_else(|| format!("endpoint URL missing port: {endpoint_addr}"))?;

            if let Ok(ip) = host.parse::<IpAddr>() {
                return Ok(SocketAddr::new(ip, port));
            }

            let mut resolved = tokio::net::lookup_host((host, port))
                .await
                .map_err(|e| format!("dns lookup failed for {host}:{port}: {e}"))?;
            if let Some(addr) = resolved.next() {
                return Ok(addr);
            }
            return Err(format!(
                "dns lookup returned no addresses for {host}:{port}"
            ));
        }

        Err(format!("bad endpoint addr: {endpoint_addr}"))
    }

    /// Connect to a QUIC media relay and set up codec pipelines.
    pub async fn connect(endpoint_addr: &str, token: &str, room_id: &str) -> Result<Self, String> {
        use paracord_transport::connection::ConnectionMode;

        // Create a client-only QUIC endpoint
        let bind_addr: std::net::SocketAddr = "0.0.0.0:0"
            .parse()
            .map_err(|e| format!("bad bind addr: {e}"))?;
        let endpoint =
            MediaEndpoint::client(bind_addr).map_err(|e| format!("endpoint create: {e}"))?;

        // Parse remote address
        let remote_addr = Self::resolve_endpoint_addr(endpoint_addr).await?;

        // Connect and authenticate
        let connecting = endpoint
            .connect(remote_addr, "paracord")
            .map_err(|e| format!("QUIC connect: {e}"))?;
        let quinn_conn = connecting
            .await
            .map_err(|e| format!("QUIC handshake: {e}"))?;
        let connection =
            MediaConnection::connect_and_auth(quinn_conn, token, ConnectionMode::Relay)
                .await
                .map_err(|e| format!("auth: {e}"))?;

        // Set up audio components
        let opus_encoder = OpusEncoder::new().map_err(|e| format!("opus encoder: {e}"))?;
        let noise_suppressor = NoiseSuppressor::new();
        let audio_playback = AudioPlayback::start().map_err(|e| format!("audio playback: {e}"))?;

        // Start audio capture
        let (audio_capture, pcm_rx) =
            AudioCapture::start().map_err(|e| format!("audio capture: {e}"))?;
        let (screen_audio_tx, screen_audio_rx) = mpsc::channel::<Vec<f32>>(64);

        // E2EE key setup
        let sender_key: [u8; 16] = rand::random();
        let mut frame_encryptor = FrameEncryptor::new();
        frame_encryptor.set_key(0, &sender_key);
        let frame_decryptor = FrameDecryptor::new();

        // Generate SSRCs
        let local_ssrc: u32 = rand::random();
        let video_ssrc: u32 = rand::random();
        let screen_ssrc: u32 = rand::random();
        let session_id = format!("native-{}", room_id);

        Ok(Self {
            endpoint,
            connection,
            audio_capture: Some(audio_capture),
            pcm_rx: Some(pcm_rx),
            screen_audio_rx: Some(screen_audio_rx),
            screen_audio_tx,
            screen_audio_enabled: Arc::new(AtomicBool::new(false)),
            audio_playback,
            opus_encoder,
            noise_suppressor,
            frame_encryptor,
            frame_decryptor,
            key_epoch: 0,
            sender_key,
            remote_audio: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            local_ssrc,
            session_id,
            muted: Arc::new(AtomicBool::new(false)),
            deafened: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(Notify::new()),
            audio_send_task: None,
            datagram_recv_task: None,
            playout_task: None,
            speaking_task: None,
            control_recv_task: None,
            #[cfg(feature = "vpx")]
            video_encoder: None,
            #[cfg(feature = "vpx")]
            screen_encoder: None,
            #[cfg(feature = "vpx")]
            video_decoders: HashMap::new(),
            #[cfg(feature = "vpx")]
            i420_convert_buf: Vec::new(),
            video_send_task: None,
            screen_send_task: None,
            video_ssrc,
            screen_ssrc,
            video_seq: 0,
            screen_seq: 0,
        })
    }

    /// Shut down the session, abort all tasks, and close the QUIC connection.
    pub async fn disconnect(&mut self) {
        // Signal all tasks to stop
        self.shutdown.notify_waiters();

        // Abort spawned tasks
        if let Some(h) = self.audio_send_task.take() {
            h.abort();
        }
        if let Some(h) = self.datagram_recv_task.take() {
            h.abort();
        }
        if let Some(h) = self.playout_task.take() {
            h.abort();
        }
        if let Some(h) = self.speaking_task.take() {
            h.abort();
        }
        if let Some(h) = self.control_recv_task.take() {
            h.abort();
        }
        if let Some(h) = self.video_send_task.take() {
            h.abort();
        }
        if let Some(h) = self.screen_send_task.take() {
            h.abort();
        }

        // Stop audio capture
        if let Some(capture) = self.audio_capture.take() {
            capture.stop();
        }

        // Stop audio playback
        self.audio_playback.stop();

        // Close QUIC connection
        self.connection.close("session ended");
    }
}
