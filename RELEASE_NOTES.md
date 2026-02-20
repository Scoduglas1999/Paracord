## What's New in v0.8.0

### Native QUIC Media Engine

A custom media transport layer built on QUIC (via `quinn`) has been added alongside the existing LiveKit integration. LiveKit code is untouched and remains fully functional.

**Server-side architecture:**

When `native_media = true`, the server starts two listeners:
- A raw QUIC endpoint (for desktop clients) that authenticates via JWT in a control stream
- A WebTransport/HTTP3 endpoint (for browser clients) that authenticates via a JSON auth message on the first bidi stream

Both endpoints feed into a shared relay that routes encrypted datagrams between participants in the same room. The relay includes room management, participant tracking, and voice activity (speaker) detection.

**New server crates:**
- `paracord-transport` -- QUIC endpoint, WebTransport server, datagram bridge, file transfer protocol
- `paracord-relay` -- Media room management, relay forwarder, participant tracking, speaker detection
- `paracord-codec` -- Opus audio encoding/decoding, VP9 video encoding/decoding (behind `vpx` feature), RNNoise noise suppression, jitter buffering, audio capture/playback via cpal
- `paracord-media-dev` -- Development utility for testing the media server independently

**New client media library** (`client/src/lib/media/`):
- Abstract `MediaEngine` interface with two implementations:
  - `BrowserMediaEngine` -- Full WebTransport + WebCodecs implementation (~1000 lines). Handles audio capture/playback, Opus encode/decode, VP9 video, E2EE encryption, jitter buffering, and canvas rendering entirely in the browser.
  - `TauriMediaEngine` -- Thin IPC wrapper that delegates to the native Rust audio pipeline in the Tauri binary.
- Transport layer: WebTransport client, datagram bridge with QSID framing, file transfer protocol
- E2EE sender key exchange with epoch rotation

**Desktop native audio pipeline (Tauri):**

The Tauri binary includes a fully functional native audio pipeline:
- Microphone capture via cpal → RNNoise noise suppression → Opus encoding → AES-GCM encryption → QUIC datagram transmission
- Receive path: QUIC datagram → AES-GCM decryption → Opus decoding → jitter buffer → cpal speaker output with multi-source mixing
- Mute/deaf toggling via atomic flags, input device switching at runtime
- E2EE sender key announcement over QUIC control stream
- VP9 video encoding/decoding available when built with the `vpx` feature flag

**What is not yet complete on the desktop path:**
- Output device switching (returns an error; input device switching works)
- Video subscription negotiation (subscribe control message is a no-op)
- Video decode on receive (frames are decrypted but not yet routed to per-SSRC decoders)

**Server configuration:**
```toml
[voice]
native_media = true    # Enable native QUIC media server (default: false)
port = 8443            # UDP port for raw QUIC endpoint (desktop clients)
wt_port = 8444         # UDP port for WebTransport/HTTP3 endpoint (browser clients)
max_participants_per_room = 50
audio_bitrate = 96000
e2ee_required = true
```

The voice join endpoint returns native media connection details when `native_media` is enabled:
```json
{
  "native_media": true,
  "media_endpoint": "https://host:8444/media",
  "media_token": "<jwt>",
  "cert_hash": "<sha256>",
  "room_name": "guild_id:channel_id",
  "session_id": "<uuid>"
}
```
The `cert_hash` field provides the SHA-256 fingerprint of the server's self-signed TLS certificate for WebTransport certificate pinning. When LiveKit is also available, its fields are returned alongside (purely additive). Clients can request explicit LiveKit fallback via `?fallback=livekit`.

### Guild File Storage Management

Server administrators and guild owners can now manage file storage policies per guild.

**New API endpoints:**
- `GET /api/v1/guilds/{id}/storage` -- View storage usage and policy
- `PATCH /api/v1/guilds/{id}/storage` -- Update storage policy (quotas, retention period, MIME type restrictions)
- `GET /api/v1/guilds/{id}/files` -- List attachments with pagination
- `DELETE /api/v1/guilds/{id}/files` -- Bulk delete attachments (up to 100)

**New admin settings:**
- `max_guild_storage_quota` -- Server-wide limit on per-guild storage
- `federation_file_cache_enabled`, `federation_file_cache_max_size`, `federation_file_cache_ttl_hours` -- Control federated file caching behavior

**Database migrations** add `guild_storage_policies` table, `content_hash` column on attachments (SHA-256), and `federation_file_cache` table. Uploads are now validated against guild policies (max file size, allowed/blocked MIME types, storage quota) before being stored.

### Federation File Sharing

Files can now be accessed across federated servers. When a user views a message from a remote server that includes attachments, the local server proxies the file download with token-based authentication and optional local caching.

**New federation endpoints:**
- `POST /_paracord/federation/v1/file/token` -- Request a download token for a remote file
- `GET /_paracord/federation/v1/file/{attachment_id}?token=...` -- Download a federated file

**New client endpoint:**
- `GET /api/v1/federated-files/{origin_server}/{attachment_id}` -- Proxy endpoint for clients to download federated files through their local server

### Gateway Media Signaling

Six new WebSocket opcodes support native media session negotiation:

| Opcode | Name | Direction | Purpose |
|--------|------|-----------|---------|
| 12 | `MEDIA_CONNECT` | Client → Server | Initiate media session |
| 15 | `MEDIA_SESSION_DESC` | Server → Client | Relay endpoint and peer list |
| 14 | `MEDIA_KEY_ANNOUNCE` | Client → Server | Announce E2EE sender keys |
| 16 | `MEDIA_KEY_DELIVER` | Server → Client | Deliver sender keys to peers |
| 13 | `MEDIA_SUBSCRIBE` | Client → Server | Subscribe to peer media tracks |
| 17 | `MEDIA_SPEAKER_UPDATE` | Server → Client | Broadcast active speaker changes |

### Desktop App (Tauri) Improvements

- **Native audio pipeline**: Full mic capture → Opus encode → E2EE → QUIC send pipeline, plus the reverse receive path with jitter buffering and speaker mixing
- **Screen capture infobar suppressed**: The Chromium "is sharing a window" bar is now auto-hidden using the WebView2 `ICoreWebView2_27` ScreenCaptureStarting API
- **Production-ready packaging**: Dev console no longer opens on launch; `console.log`/`console.info` calls are stripped from production builds
- **Diagnostics logging**: Voice session events are logged to `%LOCALAPPDATA%/Paracord/logs/client-voice.log` for troubleshooting
- **QUIC file transfer**: Upload and download files over QUIC datagrams via Tauri IPC commands
- **NSIS installer**: Windows `.exe` installer via NSIS bundler

### Stream Viewer Fixes

- **LIVE badge in sidebar**: Starting a stream now immediately shows the LIVE indicator next to your name in the voice channel participant list (previously required waiting for a gateway event)
- **Stream stop reliability**: Stopping a stream no longer hangs for 15 seconds; re-entrancy guard prevents duplicate stop calls
- **Auto-watch on stream start**: Starting a stream automatically sets you as the watched streamer so the StreamViewer renders immediately
- **Voice channel navigation**: Clicking a voice channel you're already in navigates back to it instead of disconnecting

### PostgreSQL Support

Six missing PostgreSQL migrations have been added to bring `migrations_pg/` in sync with SQLite:
- `messages_nonce_dedup` -- Nonce deduplication unique index
- `guild_storage_policies` -- Storage policy table
- `attachment_content_hash` -- SHA-256 hash column
- `federation_file_cache` -- Federation file cache (uses `BIGSERIAL` for PG)
- `storage_settings_seed` -- Default storage settings
- `hub_settings` -- Hub settings column on spaces table

### Build Configuration

- **esbuild optimizations**: `debugger` statements dropped and `console.log`/`console.info` marked as pure (tree-shaken) in production builds
- **CSP relaxed**: `img-src` and `media-src` allow `https:` and `http:` for remote media content
- **PWA service worker cleanup**: Tauri builds automatically unregister stale service workers to prevent cached asset issues

### New Workspace Dependencies

- `quinn` 0.11 -- QUIC protocol implementation
- `h3` 0.0.8 / `h3-quinn` 0.0.10 -- HTTP/3 and WebTransport support
- `audiopus` 0.3.0-rc.0 -- Opus codec bindings
- `nnnoiseless` 0.5 -- RNNoise-based noise suppression
- `cpal` 0.15 -- Cross-platform audio I/O
- `rubato` 0.15 -- Audio sample rate conversion

### Breaking Changes

- Voice join response may now include `native_media`, `media_endpoint`, `media_token`, `cert_hash` fields alongside existing LiveKit fields
- Desktop app defaults to native media path instead of LiveKit (browser is unaffected)
- Tauri installer targets changed from `all` to `nsis` + `msi` (Windows `.exe` and `.msi`)
