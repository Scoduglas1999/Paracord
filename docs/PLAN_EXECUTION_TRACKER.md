# Paracord Plan Execution Tracker

Last updated: 2026-02-15
Source plan: `C:\Users\scdou\.claude\plans\polished-watching-snowglobe.md`

This tracker is the persistent, compaction-safe execution backlog. Each task has a stable ID and a small scope.

Status legend:
- `[ ]` not started
- `[-]` in progress
- `[x]` completed

## 0. Coordination + Safety

- `T0-01` `[x]` Build and test baseline verified (`cargo check`, `cargo test`, `client build`, `client typecheck`).
- `T0-02` `[x]` Add compaction-safe task tracker with stable IDs.
- `T0-03` `[x]` Add CI checkpoint for staged feature flags and migration sanity.
- `T0-04` `[x]` Add security review checklist for each new endpoint/UI feature before merge.

## 1. Phase 1 Polish Completion

- `T1-01` `[x]` Markdown rendering enabled in message content.
- `T1-02` `[x]` Loading skeleton components integrated in core panes.
- `T1-03` `[x]` Notification wrapper + gateway trigger integrated.
- `T1-04` `[x]` Search panel UI + store wiring.
- `T1-05` `[x]` Context menu primitive + message/channel integration.
- `T1-06` `[x]` Image lightbox integrated in message attachments.
- `T1-07` `[-]` Accessibility pass:
  - `[x]` landmark roles (`navigation`, `main`, `complementary`)
  - `[x]` message log semantics (`role=log`, `aria-live`, per-message `role=article`)
  - `[x]` dialog roles across modals
  - `[x]` focus trap utility and integration in modal overlays
  - `[ ]` final keyboard + screen reader QA sweep
- `T1-08` `[-]` Keyboard navigation pass:
  - `[x]` global `Alt+Up/Down`, `Escape` panel close logic
  - `[x]` sidebar arrow-key navigation
  - `[ ]` finalize keybind persistence UX polish in settings
- `T1-09` `[x]` Toast surfacing:
  - `[x]` core stores switched
  - `[x]` eliminate remaining high-noise silent catches in voice/admin paths

## 2. Phase 2 Feature Parity

### 2.1 Threads
- `T2-01` `[x]` DB models/migrations/API thread endpoints + gateway events.
- `T2-02` `[x]` Client API methods for thread CRUD/list.
- `T2-03` `[x]` Thread panel UI (message list + input reuse).
- `T2-04` `[x]` MessageList thread actions + indicators.
- `T2-05` `[x]` Sidebar thread surfacing and navigation state.

### 2.2 Rich Text Editor
- `T2-06` `[x]` Markdown toolbar component scaffold exists.
- `T2-07` `[x]` Integrate toolbar into MessageInput selection flows.
- `T2-08` `[x]` Extend markdown parser with quotes/headings/lists/highlight.

### 2.3 User Profile Cards
- `T2-09` `[x]` Profile route/model groundwork present.
- `T2-10` `[x]` Full profile card parity (banner/mutuals/actions).

### 2.4 Webhooks
- `T2-11` `[x]` Server webhook endpoints/routes/security hardening.
- `T2-12` `[x]` Client webhook API wrapper.
- `T2-13` `[x]` Guild settings webhook management UI.

### 2.5 Channel Reordering
- `T2-14` `[x]` Bulk position endpoint exists server-side.
- `T2-15` `[x]` Sidebar drag-drop reorder UX with safe spacing/drop affordances.

### 2.6 Custom Emojis
- `T2-16` `[x]` Emoji server routes wired with validation and strict upload hardening (PNG/GIF + signature checks).
- `T2-17` `[x]` Emoji management UI in guild settings.
  - `[x]` list/read custom emojis
  - `[x]` upload UI with client-side type/size checks
  - `[x]` rename/delete flows with permission gate
- `T2-18` `[x]` Emoji picker server-emoji tab integration.
  - `[x]` guild-aware server emoji fetch in picker
  - `[x]` server emoji tab + search + selection tokenization
  - `[x]` wiring in message input and reaction picker
  - `[x]` message/reaction custom emoji rendering path

### 2.7 Polls
- `T2-19` `[x]` DB poll scaffolding present.
- `T2-20` `[x]` API route wiring + gateway events for votes.
- `T2-21` `[x]` Poll creation UI and poll renderer.

## 3. Phase 3 Quality + Performance

- `T3-01` `[ ]` Rust db/core/api test coverage expansion by module.
- `T3-02` `[x]` Add Vitest, store/unit/component tests.
- `T3-03` `[x]` Add Playwright E2E scripts and CI hooks.
- `T3-04` `[ ]` Permission/event caching implementation + invalidation.
- `T3-05` `[ ]` Message list virtualization.
- `T3-06` `[x]` `/api/v1` versioning applied in core routes.
- `T3-07` `[x]` Observability:
  - `[x]` basic `/metrics` endpoint exists
  - `[x]` middleware histograms/counters + ws gauges by event type
- `T3-08` `[-]` Error standardization:
  - `[x]` unified JSON envelope baseline
  - `[ ]` complete `{code,message,details}` rollout + client boundary detail UX

## 4. Phase 4 Advanced Features

- `T4-01` `[ ]` Forum channels (depends on complete thread UX).
- `T4-02` `[ ]` Scheduled events (DB/API/client).
- `T4-03` `[x]` Bot/integration management + OAuth2.
  - `[x]` bot application lifecycle APIs (create/update/delete/token/install list)
  - `[x]` bot auth scheme support (`Authorization: Bot <token>`) in auth middleware
  - `[x]` guild bot management UX in settings + developer portal
  - `[x]` OAuth2-style authorization page flow for bot install links
- `T4-04` `[ ]` Server discovery UX + APIs.

## 5. Phase 5 Infrastructure

- `T5-01` `[x]` Federation messaging protocol hardening.
  - `[x]` signed transport verification + replay cache enforcement (`X-Paracord-*`).
  - `[x]` durable outbound queue + delivery attempt logging + retry worker.
  - `[x]` federated identity and remote-user/message/member mapping persistence.
  - `[x]` text event coverage (`m.message`, edit/delete, reaction add/remove, member join/leave).
  - `[x]` inbound relay support for non-full-mesh topologies (hop-auth + origin signature verification).
- `T5-02` `[ ]` Dockerfile + `docker-compose.yml` for server/livekit.
- `T5-03` `[ ]` Backup/restore admin workflows.
- `T5-04` `[ ]` S3/MinIO storage backend abstraction.
- `T5-05` `[ ]` Identity portability export/import.

## 6. Granular Remaining Backlog (Compaction-Safe)

### 6.1 Threads Client Delivery
- `T2-02a` `[x]` Add thread API client methods (`create`, `list`, `archive`, `unarchive`).
- `T2-02b` `[x]` Normalize thread channel types/metadata in channel store.
- `T2-03a` `[x]` Create `ThreadPanel` shell with reuse of `MessageList` + `MessageInput`.
- `T2-03b` `[x]` Add panel open/close state + URL sync.
- `T2-04a` `[x]` Message context action: Create Thread.
- `T2-04b` `[x]` Message row thread indicators + jump interaction.
- `T2-05a` `[x]` Sidebar thread subgroup under parent channels.
- `T2-05b` `[x]` Archived thread view + restore control.
- `T2-05c` `[x]` Keyboard navigation parity for thread rows.
- `T2-05d` `[x]` Gateway thread event handling wired to channel store updates.

### 6.2 Polls End-to-End
- `T2-20a` `[x]` Wire poll routes in API router (`create`, `vote`, `results`).
- `T2-20b` `[x]` Emit and consume `POLL_VOTE_ADD/REMOVE` gateway events.
- `T2-20c` `[x]` Permission and input validation pass for poll endpoints.
- `T2-21a` `[x]` Message input poll composer (question/options/time limit).
- `T2-21b` `[x]` Poll message renderer with vote bars and counts.
- `T2-21c` `[x]` Poll expiry countdown + disabled state.

### 6.3 Rich Text Completion
- `T2-07a` `[x]` Attach markdown toolbar to input selection range APIs.
- `T2-07b` `[x]` Toolbar keyboard shortcuts (`Ctrl/Cmd+B`, etc.).
- `T2-08a` `[x]` Markdown parser support for headings/quotes/lists.
- `T2-08b` `[x]` Code block language hint + highlighting baseline.
- `T2-08c` `[x]` Regression tests for markdown parser output.

### 6.4 Quality + CI Enforcement
- `T0-03a` `[x]` Migration ordering/sanity CI job.
- `T0-03b` `[x]` Feature flag matrix smoke checks in CI.
- `T0-04a` `[x]` Endpoint security checklist template in repo docs.
- `T0-04b` `[x]` UI security checklist (XSS/file upload/clickjacking checks).
- `T3-02a` `[x]` Add Vitest harness and first store tests.
- `T3-02b` `[x]` Add markdown/security utility unit tests.
- `T3-03a` `[x]` Playwright smoke flow: login -> guild -> message -> voice.
- `T3-07a` `[x]` API middleware request histograms/counters.
- `T3-07b` `[x]` WS active connection/event gauges.
- `T3-08a` `[-]` Complete `{code,message,details}` rollout for remaining routes.
- `T3-08b` `[x]` Client error boundary detail/retry polish.

## Current Active Slice

- `ACTIVE-01` Webhooks end-to-end completion:
  - `[x]` route/module wiring
  - `[x]` security hardening (token handling and exposure)
  - `[x]` client API wrapper
  - `[x]` guild settings management UI
  - `[x]` verification (`cargo check`, `cargo test`, `client build`, `client test`)

- `ACTIVE-02` Custom emojis end-to-end completion:
  - `[x]` guild emoji API wrapper + shared custom emoji utility
  - `[x]` guild settings emoji management UI
  - `[x]` emoji picker server tab + search integration
  - `[x]` custom emoji render support in messages/reactions
  - `[x]` server upload hardening for MIME/signature validation
  - `[x]` verification (`cargo check`, `cargo test`, `client build`, `client test`)

- `ACTIVE-03` Next slice candidate (threads client foundations):
  - `[x]` `T2-02a` thread API methods
  - `[x]` `T2-02b` thread normalization in channel store
  - `[x]` `T2-03a` thread panel shell
  - `[x]` `T2-03b` thread panel route-driven open/close behavior
  - `[x]` `T2-04a` create-thread action from message menus
  - `[x]` `T2-05a` sidebar thread subgroup rendering
  - `[x]` `T2-05d` gateway thread lifecycle event sync
  - `[x]` `T2-04b` thread indicator/jump affordances in message rows
  - `[x]` `T2-05b` archived thread surfacing
  - `[x]` `T2-05c` keyboard navigation parity for thread rows

- `ACTIVE-04` Next slice candidate (poll API + gateway):
  - `[x]` `T2-20a` poll route wiring in API router
  - `[x]` `T2-20b` poll vote gateway events
  - `[x]` `T2-20c` poll permission + validation pass
  - `[x]` `T2-21a` poll composer in message input
  - `[x]` `T2-21b` poll renderer in message list
  - `[x]` `T2-21c` poll expiry countdown + disabled state

- `ACTIVE-05` Rich text completion:
  - `[x]` `T2-07a` toolbar wired to textarea selection operations
  - `[x]` `T2-07b` keyboard shortcuts for markdown insertions
  - `[x]` `T2-08a` parser support for headings, quotes, and lists
  - `[x]` `T2-08b` code block language hint + baseline highlighting
  - `[x]` `T2-08c` markdown parser regression tests

- `ACTIVE-06` Observability + hardening follow-through:
  - `[x]` restore missing server TLS module (`tls.rs`) and re-green workspace tests
  - `[x]` wire real WS metrics recording in shared core observability module
  - `[x]` export WS events-by-type metric series from `/metrics`
  - `[x]` standardize auth/admin middleware rejections onto `ApiError` envelope
  - `[x]` replace silent admin-page failure catches with surfaced toasts
  - `[x]` replace silent voice stream API cleanup catches with explicit warnings
  - `[x]` verification (`cargo check`, `cargo test`, `client build`, `client test`, `client e2e`)

- `ACTIVE-07` Bot framework completion + hardening:
  - `[x]` strict redirect URI validation for bot OAuth configuration (`https` required, localhost-only `http`)
  - `[x]` add public bot application metadata endpoint for OAuth authorization UI
  - `[x]` add `/app/oauth2/authorize` UI flow (guild selection + authorize + optional redirect continuation)
  - `[x]` improve guild settings bot install UX (owned-app picker + manual third-party ID)
  - `[x]` add developer portal install-link generation/copy/open actions
  - `[x]` apply bot-token-specific rate limiting bucket in API middleware
  - `[x]` harden webhook token generation to cryptographically secure random bytes
  - `[x]` add bot development quickstart documentation (`docs/bot-development.md`)
  - `[x]` verification (`cargo check -p paracord-api`, `client typecheck`, `client build`)
