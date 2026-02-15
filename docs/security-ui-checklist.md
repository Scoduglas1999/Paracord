# UI Security Checklist

Use this checklist for every new or changed UI feature before merge.

## Rendering and XSS
- [ ] No untrusted HTML is injected with `dangerouslySetInnerHTML`.
- [ ] User-provided text is rendered as text/React nodes, not raw HTML.
- [ ] Markdown or rich text renderers are tested against script/event-handler payloads.
- [ ] Link rendering enforces safe protocols and uses `rel="noopener noreferrer"` for external targets.

## File and Media Safety
- [ ] Client-side file type and size checks are present for uploads.
- [ ] Image previews only accept allowed MIME types/data URLs.
- [ ] Download/open actions do not auto-execute active content.

## Auth and Sensitive Data
- [ ] Tokens/secrets are never rendered, logged, or copied into error toasts.
- [ ] Sensitive actions require explicit user intent (confirmations for destructive actions).
- [ ] Auth failure states clear stale session state and redirect safely.

## Permission-Aware UX
- [ ] UI controls for privileged actions are hidden/disabled when user lacks permission.
- [ ] Server-side permission errors are surfaced clearly without leaking internals.
- [ ] Cross-guild/channel data is not exposed through cached UI state.

## Browser Security Posture
- [ ] Clipboard writes are explicit and user-triggered.
- [ ] New windows/tabs avoid opener leaks.
- [ ] Clickjacking-sensitive flows assume server `X-Frame-Options`/CSP frame protections.

## Resilience and Reporting
- [ ] Errors are surfaced through user-visible toasts or boundaries (no silent catches).
- [ ] Error boundary fallback provides retry/reload path.
- [ ] New flows include unit/E2E coverage for at least one failure path.
