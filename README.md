<p align="center">
  <img src="docs/logo-banner.svg" alt="Paracord" width="800"/>
</p>

<p align="center">
  A self-hostable, open-source Discord alternative with federation, E2E encryption, and a bot platform.
</p>

<p align="center">
  <a href="../../releases/latest">Download</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#development">Development</a>
</p>

---

## The Why

On February 9th, 2026, Discord's CEO announced that they would be starting to roll out age verification in the coming month. This meant that all accounts would be labeled as "teen" and one would have to prove they were an adult through an AI powered face scan or uploading government issued ID. The privacy implications of this should be incredibly obvious, and at least my group of friends that regularly used Discord were 100% against giving Discord any of this information, and frankly, didn't feel they should have to. So Paracord was built as a privacy-first, self-hosted alternative in under a week, with full federation and decentralized operation now being built out in active phases. Many new features are coming to Paracord at breakneck speed, and it already includes many of Nitro's big features like high resolution streaming, just without the paywall :).

## Features

### Text Chat

Guilds, channels, and DMs with the full messaging experience — send, edit, delete, reply, pin, react with emoji, attach files via drag-and-drop, and see who's typing in real-time. Images embed inline with a lightbox viewer (zoom, pan, keyboard navigation), files show name and size, and messages group by author just like you'd expect. Full-text message search with author and date filters. Markdown toolbar with keyboard shortcuts (Ctrl+B, Ctrl+I, etc.) and right-click context menus for quick actions.

<img width="2553" height="1439" alt="image" src="https://github.com/user-attachments/assets/f431247f-6d2e-4bb5-b1e2-7f65e13144c3" />

### Threads

Start a thread from any message to branch a conversation without cluttering the main channel. Thread panel slides in from the side so you can follow both the channel and the thread at the same time.

### Polls

Create polls with 2-10 options, optional multi-select, and expiry timers. Votes update live and results render inline in the message feed.

### Forum Channels

Dedicated forum-style channels with tag support for organizing longer-form discussions. Think Discord's forum channels, but self-hosted.

### Voice Chat

WebRTC voice powered by a bundled LiveKit SFU. Mute, deafen, pick your mic and speakers, and toggle noise suppression, echo cancellation, and noise gate. Speaking indicators light up in real-time, and join/leave sounds play when people hop in and out of channels. Configurable keybinds for mute, deafen, and push-to-talk. Split-pane layout for viewing streams while staying in the voice channel.

<img width="2558" height="1439" alt="image" src="https://github.com/user-attachments/assets/9ec24fa3-1110-4d21-983f-7df434e39f43" />

### Live Streaming

Share your screen or a specific window at up to 4K/100Mbps with six quality presets. System audio is captured natively on Windows (WASAPI loopback) and Linux (PulseAudio monitor) so viewers actually hear your game or movie audio — not just silence. The stream viewer has quality selection, volume control, a fullscreen button, and an elapsed time counter.

| Preset | Resolution | FPS | Bitrate |
|--------|-----------|-----|---------|
| 720p 30 | 1280x720 | 30 | 5 Mbps |
| 1080p 60 | 1920x1080 | 60 | 15 Mbps |
| 1440p 60 | 2560x1440 | 60 | 25 Mbps |
| 4K 60 | 3840x2160 | 60 | 40 Mbps |
| Movie 50 | 3840x2160 | 60 | 50 Mbps |
| Movie 100 | 3840x2160 | 60 | 100 Mbps |

### Roles & Permissions

30 granular permission flags with role hierarchy, color-coded role names, and per-channel permission overwrites. Create roles, assign colors and permissions, drag to reorder priority, and assign them to members. Admins get full access; everyone else gets exactly what you give them.

### Friends & DMs

Add friends by username, accept or reject incoming requests, block users you don't want to hear from, and filter your friends list by online status. Open a DM with anyone — DMs use the same full-featured chat as guild channels. DMs support optional end-to-end encryption using X25519 key exchange and AES-GCM.

### Custom Emoji

Upload and manage custom emoji per guild. The emoji picker includes your server's custom emoji alongside standard Unicode emoji with category browsing and search.

### Scheduled Events

Create guild events with start/end times, descriptions, and an RSVP system so members can mark whether they're attending.

### Bots & Webhooks

A full bot platform with a developer dashboard, OAuth2 authorization flow, and bot user accounts. Create bot applications, manage tokens, and install bots to guilds. Webhooks let external services push messages into channels with secure token management.

### Server Discovery

Browse public guilds with categories and search. Server owners can list their guilds for discovery so new users can find communities without needing an invite link.

### Moderation

Ban and kick members (with reasons), browse a full audit log of every admin action — role changes, channel edits, kicks, bans, invite management — and manage active invites from the guild settings panel. The first registered user on a server is auto-promoted to admin.

### Server Admin

Admins can toggle registration, rename the server, set a description, cap guilds-per-user and members-per-guild, view server stats, manage all users and guilds, browse security event logs, configure data retention policies, manage backups, and trigger a remote update & restart — all from the settings panel.

### Security

Paracord takes security seriously. The server ships with:

- **Session-backed JWTs** with refresh token rotation and device tracking
- **Rate limiting** with per-IP, per-device, and per-account guards with exponential backoff
- **File upload security** — attachment ownership enforcement, content-type validation, malware scanning hooks
- **TLS** — auto-generated self-signed certs, ACME/Let's Encrypt support, HSTS
- **Security headers** — CSP, X-Content-Type-Options, X-Frame-Options, CORP, COOP
- **At-rest encryption** — AES-256-GCM file encryption, optional SQLCipher database encryption
- **E2E encrypted DMs** — X25519 key exchange + AES-GCM
- **Audit trail** — security events logged for all sensitive operations
- **Cryptographic identity** — Ed25519 keypair authentication with BIP39 recovery phrases

### Federation

Server-to-server federation is in active development with the transport layer already in place:

- Ed25519 HTTP signature verification for all federated requests
- `.well-known/paracord/server` discovery protocol
- Server key exchange and trust management
- Cross-server event ingestion with body hashing and clock skew tolerance
- Namespace and membership sync primitives
- Federated media relay for voice

### Self-Hosted & Zero-Config

One binary, one SQLite database, zero external dependencies. Run the server and it auto-generates config, TLS certificates, and database on first start. UPnP (with NAT-PMP/PCP fallback) auto-forwards ports on most home routers. The web UI is baked into the server binary — no separate web server, no Docker, no nginx.

### Desktop Client

Native app built with Tauri v2 for Windows and Linux. Auto-trusts self-signed server certificates so you don't have to click through browser warnings. Captures system audio natively for streams (WASAPI on Windows, PulseAudio on Linux). Configurable keybinds for mute, deafen, and push-to-talk. Built-in auto-updater so you always get the latest version. Activity detection broadcasts what you're running as rich presence.

### Multi-Server

Connect to multiple Paracord servers at once. A server rail in the sidebar lets you switch between connected servers, each with its own gateway connection and state. Your Ed25519 identity carries across servers — no need to create separate accounts.

### Appearance

Dark, light, and AMOLED black themes. Compact or cozy message density. Custom CSS support. The UI is a command palette shortcut away from anywhere (Ctrl+K).

### Coming Soon

- **Federation parity** — Full cross-server messaging, membership sync, and moderation in progress
- **Video calls** — Camera in voice channels (backend support exists, UI in progress)
- **macOS native audio capture** — Falls back to browser audio today; ScreenCaptureKit planned

## Download

Grab the latest release from the [Releases page](../../releases/latest).

### Server

| Platform | Download | What's Included |
|----------|----------|-----------------|
| Windows x64 | `paracord-server-windows-x64-*.zip` | Server + LiveKit bundled. Extract and run. |
| Linux x64 | `paracord-server-linux-x64-*.tar.gz` | Server + LiveKit bundled. Extract, chmod +x, run. |

### Desktop Client

| Platform | Download | Format |
|----------|----------|--------|
| Windows | `Paracord_*_x64-setup.exe` | Installer with Start Menu shortcut |
| Windows | `Paracord_*_x64_en-US.msi` | MSI for silent/enterprise deployment |
| Linux | `Paracord_*_amd64.deb` | Debian/Ubuntu package |

### Browser

No download needed — open `https://<server-ip>:8443` in any modern browser.

## Quick Start

### Hosting a Server

**Windows:**
1. Download and extract the server zip
2. Double-click `paracord-server.exe`
3. Config, database, and TLS certs are auto-created on first run
4. Share the URL printed in the console with friends

**Linux:**
```bash
tar xzf paracord-server-linux-x64-*.tar.gz
chmod +x paracord-server livekit-server
./paracord-server
```

That's it. UPnP auto-forwards ports on most home routers. If your router doesn't support UPnP, forward TCP+UDP port 8080 and TCP port 8443 (HTTPS).

### Docker

```bash
git clone https://github.com/Scoduglas1999/Paracord.git
cd Paracord
docker compose up -d
```

This starts the Paracord server and a LiveKit SFU instance. See `docker-compose.yml` for the full list of environment variables, or check [docs/docker-setup.md](docs/docker-setup.md) for detailed configuration.

### Joining a Server

**Desktop app:** Install, paste the server URL, create an account.

**Browser:** Navigate to `https://<server-ip>:8443`, accept the self-signed certificate warning, and create an account.

> **Why HTTPS?** Browsers require a secure context for microphone and camera access. The server auto-generates self-signed TLS certificates and serves HTTPS on port 8443 so voice and streaming work out of the box.

## Configuration

The server auto-generates `config/paracord.toml` on first run with:
- Random JWT secret and LiveKit API credentials
- SQLite database in `./data/`
- TLS certificates in `./data/certs/`
- UPnP enabled by default

All settings can be overridden via environment variables prefixed with `PARACORD_`. See `paracord.example.toml` in the server package for the full reference.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Rust (axum, tokio, SQLx) |
| Client | Tauri v2 + React 19 + TypeScript |
| Database | SQLite (embedded, zero-config) + optional SQLCipher encryption |
| Voice/Video | LiveKit SFU (bundled) |
| State | Zustand v5 |
| Styling | Tailwind CSS v4 |
| Auth | Argon2 hashing, JWT sessions, Ed25519 cryptographic identity |
| Encryption | X25519 + AES-GCM (E2E DMs), AES-256-GCM (at-rest) |
| TLS | rustls + rcgen auto-certs, ACME/Let's Encrypt |
| Networking | UPnP IGD + NAT-PMP/PCP fallback |
| CI/CD | GitHub Actions (build, test, security audit, DAST) |
| Testing | Vitest + Playwright E2E |

## Platform Support

| | Server | Desktop Client | Browser |
|---|---|---|---|
| **Windows x64** | Yes | Yes | Yes |
| **Linux x64** | Yes | Yes (.deb) | Yes |
| **macOS** | Build from source | Build from source | Yes |

## Development

### Prerequisites
- [Rust 1.85+](https://rustup.rs/)
- [Node.js 22+](https://nodejs.org/)

### Running Locally

```bash
# Clone and enter project
git clone https://github.com/Scoduglas1999/Paracord.git
cd Paracord

# Terminal 1: client dev server
cd client
npm install
npm run dev

# Terminal 2: server (Vite proxies API/WS to it)
cargo run --bin paracord-server --no-default-features
```

### Building for Release

```bash
# Build client web UI
cd client && npm install && npm run build && cd ..

# Build server with embedded web UI
cargo build --release --bin paracord-server

# The binary includes the web UI — no --web-dir needed
./target/release/paracord-server
```

### Building the Desktop Client

```bash
cd client
npm install
npx tauri build
```

Produces `.exe` + `.msi` on Windows, `.deb` + `.AppImage` on Linux.

## Project Structure

```
paracord/
├── crates/                 # Rust server workspace
│   ├── paracord-server/    # Binary entry point, TLS, UPnP, LiveKit management
│   ├── paracord-api/       # REST API routes (90+ endpoints)
│   ├── paracord-ws/        # WebSocket gateway (events, presence, typing)
│   ├── paracord-core/      # Business logic, permissions engine, event bus
│   ├── paracord-db/        # SQLite via SQLx (26 migrations)
│   ├── paracord-federation/# Server-to-server federation (Ed25519 signed transport)
│   ├── paracord-models/    # Shared types and data structures
│   ├── paracord-media/     # File storage (local + S3) + LiveKit voice/streaming
│   └── paracord-util/      # Snowflake IDs, validation, at-rest encryption
├── client/                 # Tauri v2 + React client
│   ├── src/                # React TypeScript frontend
│   │   ├── components/     # UI (chat, voice, guilds, threads, polls, forums, bots)
│   │   ├── stores/         # 17 Zustand state stores
│   │   ├── gateway/        # WebSocket connection + event dispatch
│   │   └── pages/          # 20 route pages
│   ├── src-tauri/          # Native Rust backend (system audio, TLS, auto-updater)
│   └── e2e/                # Playwright E2E tests
├── docs/                   # Design specs, security docs, API contracts
└── docker-compose.yml      # Docker deployment with LiveKit
```

## License

Source-available. See [LICENSE](LICENSE) for full terms. You may use, study, and modify the software for personal use, and share official releases. Redistribution of modified versions and derivative works is not permitted without written permission.
