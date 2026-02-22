mod audio_capture;
mod commands;
mod native_media;

use tauri::Manager;

#[cfg(windows)]
fn configure_webview2_overrides(app: &tauri::App) {
    use webview2_com::ServerCertificateErrorDetectedEventHandler;
    use webview2_com::ScreenCaptureStartingEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_14, ICoreWebView2_27,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
    };
    use windows_core::Interface;

    let Some(main_webview) = app.get_webview_window("main") else {
        return;
    };

    if let Err(err) = main_webview.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };

        // --- Accept self-signed TLS certificates (dev/self-hosted) ---
        if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
            let handler =
                ServerCertificateErrorDetectedEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        let _ = args.SetAction(
                            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                        );
                    }
                    Ok(())
                }));

            let mut token = 0_i64;
            if let Err(e) = core14.add_ServerCertificateErrorDetected(&handler, &mut token) {
                eprintln!("failed to register WebView2 certificate override: {e}");
            }
        }

        // --- Suppress the "is sharing a window" infobar during screen capture ---
        // Setting Handled=true tells WebView2 that the host app owns the screen
        // capture UI, so the default Chromium infobar is not shown.
        if let Ok(core27) = core.cast::<ICoreWebView2_27>() {
            let handler =
                ScreenCaptureStartingEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        let _ = args.SetHandled(true);
                    }
                    Ok(())
                }));

            let mut token = 0_i64;
            if let Err(e) = core27.add_ScreenCaptureStarting(&handler, &mut token) {
                eprintln!("failed to register WebView2 screen capture handler: {e}");
            }
        }
    }) {
        eprintln!("failed to configure WebView2 overrides: {err}");
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(native_media::MediaState::new())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let startup_line = format!(
                "{} [desktop] startup version={} pid={}",
                chrono_like_timestamp_utc(),
                env!("CARGO_PKG_VERSION"),
                std::process::id()
            );
            if let Err(err) = commands::append_client_log(app.handle().clone(), startup_line) {
                eprintln!("failed to write startup diagnostics log line: {err}");
            }
            #[cfg(windows)]
            configure_webview2_overrides(app);
            Ok(())
        });

    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::greet,
        commands::get_app_version,
        commands::get_update_target,
        commands::append_client_log,
        commands::get_client_log_path,
        commands::secure_store_set,
        commands::secure_store_get,
        commands::secure_store_delete,
        commands::secure_store_fallback_encrypt,
        commands::secure_store_fallback_decrypt,
        commands::set_activity_sharing_enabled,
        commands::get_foreground_application,
        audio_capture::set_system_audio_capture_enabled,
        audio_capture::start_system_audio_capture,
        audio_capture::stop_system_audio_capture,
        // Native QUIC media engine
        native_media::commands::quic_upload_file,
        native_media::commands::quic_download_file,
        native_media::commands::start_voice_session,
        native_media::commands::stop_voice_session,
        native_media::commands::voice_set_mute,
        native_media::commands::voice_set_deaf,
        native_media::commands::voice_switch_input_device,
        native_media::commands::voice_switch_output_device,
        native_media::commands::voice_enable_video,
        native_media::commands::voice_start_screen_share,
        native_media::commands::voice_stop_screen_share,
        native_media::commands::voice_push_video_frame,
        native_media::commands::voice_push_screen_frame,
        native_media::commands::voice_set_screen_audio_enabled,
        native_media::commands::voice_push_screen_audio_frame,
        native_media::commands::media_subscribe_video,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn chrono_like_timestamp_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("unix_ts={now}")
}
