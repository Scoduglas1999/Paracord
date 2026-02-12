mod audio_capture;
#[cfg(windows)]
use windows_core::Interface;
mod commands;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Accept self-signed TLS certificates so the desktop app can
            // connect to Paracord servers that use auto-generated certs.

            #[cfg(windows)]
            {
                use tauri::Manager;
                let webview = app.get_webview_window("main")
                    .expect("main window not found");
                webview.with_webview(|platform_webview| {
                    use webview2_com::ServerCertificateErrorDetectedEventHandler;
                    use webview2_com::Microsoft::Web::WebView2::Win32::*;

                    unsafe {
                        let core: ICoreWebView2 = platform_webview
                            .controller()
                            .CoreWebView2()
                            .expect("failed to get CoreWebView2");
                        let core14: ICoreWebView2_14 = core
                            .cast()
                            .expect("WebView2 runtime too old for certificate handling");

                        let mut token: i64 = 0;
                        core14.add_ServerCertificateErrorDetected(
                            &ServerCertificateErrorDetectedEventHandler::create(Box::new(
                                |_, args| {
                                    if let Some(args) = args {
                                        args.SetAction(
                                            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                                        )?;
                                    }
                                    Ok(())
                                },
                            )),
                            &mut token,
                        ).expect("failed to register certificate handler");
                    }
                }).expect("with_webview failed");
            }

            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                let webview = app.get_webview_window("main")
                    .expect("main window not found");
                webview.with_webview(|platform_webview| {
                    use webkit2gtk::{WebViewExt, WebContextExt, TLSErrorsPolicy};
                    let wk_webview = platform_webview.inner().clone();
                    if let Some(context) = wk_webview.web_context() {
                        context.set_tls_errors_policy(TLSErrorsPolicy::Ignore);
                    }
                }).expect("with_webview failed");
            }

            // macOS (WKWebView) does not expose a simple API to ignore TLS
            // certificate errors. WKWebView requires implementing a custom
            // WKNavigationDelegate with
            // `webView:didReceiveAuthenticationChallenge:completionHandler:`
            // which would need objc runtime calls to swizzle Tauri's existing
            // delegate. For now, macOS users must install self-signed CA certs
            // into the system Keychain and mark them as trusted, or use a
            // properly signed certificate.

            Ok(())
        });

    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::greet,
        commands::get_app_version,
        audio_capture::start_system_audio_capture,
        audio_capture::stop_system_audio_capture,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
