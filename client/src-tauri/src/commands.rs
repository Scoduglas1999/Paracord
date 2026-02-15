use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use std::path::Path;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Paracord.", name)
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdateTargetInfo {
    os: String,
    arch: String,
    installer_preference: String,
}

#[tauri::command]
pub fn get_update_target() -> UpdateTargetInfo {
    let installer_preference = if cfg!(target_os = "windows") {
        "msi".to_string()
    } else if cfg!(target_os = "linux") {
        let prefers_appimage = std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.ends_with(".AppImage")))
            .unwrap_or(false);
        if prefers_appimage {
            "appimage".to_string()
        } else {
            "deb".to_string()
        }
    } else {
        "asset".to_string()
    };

    UpdateTargetInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        installer_preference,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ForegroundApplication {
    pid: u32,
    process_name: String,
    display_name: String,
    executable_path: Option<String>,
    window_title: Option<String>,
}

fn readable_process_name(raw: &str) -> String {
    let without_ext = raw.trim_end_matches(".exe");
    let cleaned = without_ext.replace(['_', '-'], " ");
    let mut out = String::new();
    for (idx, part) in cleaned.split_whitespace().enumerate() {
        if idx > 0 {
            out.push(' ');
        }
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            out.push(first.to_ascii_uppercase());
            out.push_str(chars.as_str());
        }
    }
    if out.is_empty() {
        "Unknown App".to_string()
    } else {
        out
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn run_command_capture(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_first_u32(text: &str) -> Option<u32> {
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

fn process_name_from_path(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
}

const SECURE_STORE_SERVICE: &str = "com.paracord.app";
const SECURE_STORE_KEY_PREFIX: &str = "paracord:";
const SECURE_STORE_FALLBACK_KEY_FILE: &str = "secure-store-fallback.key";
const SECURE_STORE_FALLBACK_NONCE_LEN: usize = 12;
static ACTIVITY_SHARING_ENABLED: AtomicBool = AtomicBool::new(false);

fn validate_secure_store_key(key: &str) -> Result<(), String> {
    if !key.starts_with(SECURE_STORE_KEY_PREFIX) {
        return Err("secure store key must start with 'paracord:'".into());
    }
    if key.len() > 128 {
        return Err("secure store key is too long".into());
    }
    Ok(())
}

fn secure_store_fallback_key_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    dir.push("security");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create security directory: {e}"))?;
    Ok(dir.join(SECURE_STORE_FALLBACK_KEY_FILE))
}

fn load_or_create_secure_store_fallback_key(app: &tauri::AppHandle) -> Result<[u8; 32], String> {
    let path = secure_store_fallback_key_path(app)?;
    if path.is_file() {
        let existing =
            std::fs::read(&path).map_err(|e| format!("failed to read fallback key: {e}"))?;
        if existing.len() != 32 {
            return Err("fallback key has invalid length".into());
        }
        let mut key = [0_u8; 32];
        key.copy_from_slice(&existing);
        return Ok(key);
    }

    let mut key = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|e| format!("failed to create fallback key: {e}"))?;
        std::io::Write::write_all(&mut file, &key)
            .map_err(|e| format!("failed to write fallback key: {e}"))?;
        let _ = file.sync_all();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    validate_secure_store_key(&key)?;
    let entry = keyring::Entry::new(SECURE_STORE_SERVICE, &key)
        .map_err(|e| format!("secure store init failed: {e}"))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("secure store write failed: {e}"))
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    validate_secure_store_key(&key)?;
    let entry = keyring::Entry::new(SECURE_STORE_SERVICE, &key)
        .map_err(|e| format!("secure store init failed: {e}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("secure store read failed: {err}")),
    }
}

#[tauri::command]
pub fn secure_store_delete(key: String) -> Result<(), String> {
    validate_secure_store_key(&key)?;
    let entry = keyring::Entry::new(SECURE_STORE_SERVICE, &key)
        .map_err(|e| format!("secure store init failed: {e}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("secure store delete failed: {err}")),
    }
}

#[tauri::command]
pub fn secure_store_fallback_encrypt(
    app: tauri::AppHandle,
    plaintext: String,
) -> Result<String, String> {
    let key = load_or_create_secure_store_fallback_key(&app)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "invalid fallback key".to_string())?;
    let mut nonce_bytes = [0_u8; SECURE_STORE_FALLBACK_NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| "fallback encryption failed".to_string())?;

    let mut payload = Vec::with_capacity(SECURE_STORE_FALLBACK_NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(BASE64_STANDARD.encode(payload))
}

#[tauri::command]
pub fn secure_store_fallback_decrypt(
    app: tauri::AppHandle,
    payload: String,
) -> Result<String, String> {
    let key = load_or_create_secure_store_fallback_key(&app)?;
    let decoded = BASE64_STANDARD
        .decode(payload.as_bytes())
        .map_err(|_| "fallback payload is not valid base64".to_string())?;
    if decoded.len() <= SECURE_STORE_FALLBACK_NONCE_LEN {
        return Err("fallback payload is invalid".into());
    }

    let nonce = Nonce::from_slice(&decoded[..SECURE_STORE_FALLBACK_NONCE_LEN]);
    let ciphertext = &decoded[SECURE_STORE_FALLBACK_NONCE_LEN..];
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "invalid fallback key".to_string())?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "fallback decryption failed".to_string())?;

    String::from_utf8(plaintext).map_err(|_| "fallback plaintext is not valid utf-8".to_string())
}

#[tauri::command]
pub fn set_activity_sharing_enabled(enabled: bool) {
    ACTIVITY_SHARING_ENABLED.store(enabled, Ordering::SeqCst);
}

#[cfg(windows)]
fn get_window_title(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 {
            return None;
        }
        let title = String::from_utf16_lossy(&buffer[..copied as usize])
            .trim()
            .to_string();
        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    }
}

#[cfg(windows)]
fn get_process_executable_path(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_core::PWSTR;

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = vec![0u16; 32768];
        let mut len = buffer.len() as u32;
        let success = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        if !success || len == 0 {
            return None;
        }
        let value = String::from_utf16_lossy(&buffer[..len as usize])
            .trim()
            .to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
}

#[cfg(target_os = "macos")]
fn detect_foreground_application_macos() -> Option<ForegroundApplication> {
    let app_name = run_command_capture(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ],
    )?;

    let pid = run_command_capture(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to get unix id of first application process whose frontmost is true",
        ],
    )
    .and_then(|value| parse_first_u32(&value))?;

    if pid == std::process::id() {
        return None;
    }

    let window_title = run_command_capture(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to tell (first application process whose frontmost is true) to get name of front window",
        ],
    );

    let executable_path = run_command_capture("ps", &["-p", &pid.to_string(), "-o", "comm="]);
    let process_name = executable_path
        .as_ref()
        .and_then(|path| process_name_from_path(path))
        .unwrap_or_else(|| app_name.clone());

    if process_name.to_lowercase().contains("paracord") {
        return None;
    }

    Some(ForegroundApplication {
        pid,
        process_name,
        display_name: app_name,
        executable_path,
        window_title,
    })
}

#[cfg(target_os = "linux")]
fn parse_xprop_string_value(raw: &str) -> Option<String> {
    if let Some(first_quote) = raw.find('"') {
        let rest = &raw[first_quote + 1..];
        if let Some(last_quote) = rest.rfind('"') {
            let value = rest[..last_quote].trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    raw.split('=')
        .nth(1)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
fn detect_foreground_application_linux() -> Option<ForegroundApplication> {
    // X11 path via xprop. On Wayland this may return nothing depending on compositor.
    let active_window_raw = run_command_capture("xprop", &["-root", "_NET_ACTIVE_WINDOW"])?;
    let window_id = active_window_raw
        .split_whitespace()
        .last()
        .map(|token| token.trim().to_string())?;
    if window_id == "0x0" {
        return None;
    }

    let pid_raw = run_command_capture("xprop", &["-id", &window_id, "_NET_WM_PID"])?;
    let pid = parse_first_u32(&pid_raw)?;
    if pid == 0 || pid == std::process::id() {
        return None;
    }

    let window_title = run_command_capture("xprop", &["-id", &window_id, "_NET_WM_NAME"])
        .and_then(|raw| parse_xprop_string_value(&raw))
        .or_else(|| {
            run_command_capture("xprop", &["-id", &window_id, "WM_NAME"])
                .and_then(|raw| parse_xprop_string_value(&raw))
        });

    let executable_path = std::fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let process_name = executable_path
        .as_ref()
        .and_then(|path| process_name_from_path(path))
        .or_else(|| std::fs::read_to_string(format!("/proc/{pid}/comm")).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("pid-{pid}"));

    if process_name.to_lowercase().contains("paracord") {
        return None;
    }

    Some(ForegroundApplication {
        pid,
        display_name: readable_process_name(&process_name),
        process_name,
        executable_path,
        window_title,
    })
}

#[tauri::command]
pub fn get_foreground_application() -> Option<ForegroundApplication> {
    if !ACTIVITY_SHARING_ENABLED.load(Ordering::SeqCst) {
        return None;
    }

    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::GetCurrentProcessId;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }

            let mut pid = 0u32;
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 || pid == GetCurrentProcessId() {
                return None;
            }

            let executable_path = get_process_executable_path(pid);
            let process_name = executable_path
                .as_ref()
                .and_then(|path| process_name_from_path(path))
                .unwrap_or_else(|| format!("pid-{}", pid));

            if process_name.to_lowercase().contains("paracord") {
                return None;
            }

            return Some(ForegroundApplication {
                pid,
                display_name: readable_process_name(&process_name),
                process_name,
                executable_path,
                window_title: get_window_title(hwnd),
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        detect_foreground_application_macos()
    }

    #[cfg(target_os = "linux")]
    {
        detect_foreground_application_linux()
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        None
    }
}
