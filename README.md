<p align="center">
  <img src="docs/logo-banner.svg" alt="Paracord" width="800"/>
</p>

A decentralized, self-hostable, open-source Discord alternative. Take back control of your communication.

## Features

- **Text Chat** - Guilds, channels, DMs, reactions, file sharing, typing indicators
- **Voice & Video** - WebRTC via bundled LiveKit SFU, mute/deafen, push-to-talk
- **Live Streaming** - Screen share up to 4K/60fps with quality presets
- **Roles & Permissions** - Granular permission bitfields, channel overwrites
- **Friends System** - Add friends, block users, pending requests
- **Customization** - Themes (dark/light/amoled), custom CSS injection
- **Self-Hosted** - Single executable, SQLite database, zero external dependencies

## Download

Grab the latest release from the [Releases page](../../releases).

| Download | Description |
|----------|-------------|
| `paracord-server-windows-x64-*.zip` | Server with LiveKit bundled. Extract and run! |
| `Paracord-Setup-*.exe` | Desktop client installer for Windows |

## Quick Start

### Hosting a Server

1. Download and extract the server zip
2. Run `paracord-server.exe`
3. Config and database are auto-created on first run
4. Share the public URL printed in the console with friends

That's it. UPnP auto-forwards ports on most home routers. If your router doesn't support UPnP, forward TCP port 8080 and TCP/UDP 7880-7892.

### Joining a Server

1. Install the Paracord client
2. Enter the server URL (e.g., `73.45.123.99:8080`)
3. Create an account and start chatting!

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Rust (axum, tokio, SQLx) |
| Client | Tauri v2 + React 19 + TypeScript |
| Database | SQLite (embedded, zero-config) |
| Voice/Video | LiveKit SFU (bundled) |
| State | Zustand v5 |
| Styling | Tailwind CSS v4 |

## Development

### Prerequisites
- [Rust 1.85+](https://rustup.rs/)
- [Node.js 22+](https://nodejs.org/)

### Running Locally

```bash
# Clone and enter project
git clone <repo-url>
cd paracord

# Build and run client dev server (in one terminal)
cd client
npm install
npm run dev

# Run server without embedded UI (in another terminal)
# Vite dev server proxies API/WS requests to the server
cargo run --bin paracord-server --no-default-features
```

### Building for Release

```bash
# Build client web UI
cd client && npm install && npm run build && cd ..

# Build server with embedded web UI
cargo build --release --bin paracord-server

# The server binary now includes the web UI - no --web-dir needed
./target/release/paracord-server
```

### Configuration

The server auto-generates `config/paracord.toml` on first run with:
- Random JWT secret (64-char hex)
- Random LiveKit API credentials
- SQLite database in `./data/`
- UPnP enabled by default

All settings can be overridden via environment variables prefixed with `PARACORD_`.

## Project Structure

```
paracord/
├── crates/                 # Rust server workspace (9 crates)
│   ├── paracord-server/    # Binary entry point + embedded UI
│   ├── paracord-api/       # REST API (axum handlers)
│   ├── paracord-ws/        # WebSocket gateway
│   ├── paracord-core/      # Business logic + event bus
│   ├── paracord-db/        # Database layer (SQLx + SQLite)
│   ├── paracord-federation/# Matrix federation (future)
│   ├── paracord-models/    # Shared types
│   ├── paracord-media/     # File storage + LiveKit voice
│   └── paracord-util/      # Snowflake IDs, validation
├── client/                 # Tauri v2 + React client
│   ├── src/                # React TypeScript frontend
│   └── src-tauri/          # Tauri Rust backend
├── installer/              # Inno Setup installer script
├── config/                 # Server configuration
├── scripts/                # Dev setup & backup scripts
└── docs/                   # Documentation
```

## License

AGPL-3.0-or-later
