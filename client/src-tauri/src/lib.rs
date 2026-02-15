mod audio_capture;
mod commands;

use tauri::Manager;

#[cfg(windows)]
fn enable_windows_self_signed_https_support(app: &tauri::App) {
    use webview2_com::ServerCertificateErrorDetectedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_14, COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
    };
    use windows_core::Interface;

    let Some(main_webview) = app.get_webview_window("main") else {
        return;
    };

    if let Err(err) = main_webview.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core14) = core.cast::<ICoreWebView2_14>() else {
            return;
        };

        let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let _ = args.SetAction(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW);
            }
            Ok(())
        }));

        let mut token = 0_i64;
        if let Err(reg_err) = core14.add_ServerCertificateErrorDetected(&handler, &mut token) {
            eprintln!(
                "failed to register WebView2 certificate override handler: {reg_err}"
            );
        }
    }) {
        eprintln!("failed to configure WebView2 certificate override: {err}");
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(windows)]
            enable_windows_self_signed_https_support(app);
            Ok(())
        });

    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::greet,
        commands::get_app_version,
        commands::get_update_target,
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
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
