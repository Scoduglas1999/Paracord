pub mod audio_pipeline;
pub mod commands;
pub mod events;
pub mod file_transfer;
pub mod session;
pub mod video_pipeline;

pub use session::NativeMediaSession;

/// Shared media state managed by Tauri.
/// Holds the optional active media session behind a tokio Mutex
/// so async command handlers can access it safely.
pub struct MediaState {
    pub session: tokio::sync::Mutex<Option<NativeMediaSession>>,
}

impl MediaState {
    pub fn new() -> Self {
        Self {
            session: tokio::sync::Mutex::new(None),
        }
    }
}
