# Bot Development Quickstart

This guide covers the current Paracord bot flow end-to-end:

1. Create a bot application in `Developer Portal` (`/app/developers`).
2. Copy the generated bot token immediately (it is only shown on creation or regeneration).
3. Install the bot into a server:
   - Use the install link from `Developer Portal`, or
   - Open `Server Settings -> Bots` and add the application by ID.
4. Call APIs as the bot using `Authorization: Bot <token>`.

## OAuth-style install link

Paracord supports an authorization page at:

`/app/oauth2/authorize?client_id=<APP_ID>&permissions=<PERMISSIONS>`

Optional query params:

- `redirect_uri`: must match the application redirect URI exactly.
- `state`: opaque value returned to the redirect target.

After authorization, Paracord can redirect back with:

- `authorized=true`
- `application_id=<APP_ID>`
- `guild_id=<GUILD_ID>`
- `state=<STATE>` (if provided)

## Bot authentication

Use the bot token in the standard HTTP `Authorization` header:

```http
Authorization: Bot <TOKEN>
```

Bot tokens are stored hashed server-side and validated against `bot_applications`.

## Example: send a message

```bash
curl -X POST "https://your-paracord.example/api/v1/channels/<CHANNEL_ID>/messages" \
  -H "Authorization: Bot <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello from my Paracord bot"}'
```

## Security notes

- Keep tokens in secure server-side storage only.
- Regenerate tokens immediately if leaked.
- Use minimal permissions when generating install links.
- `redirect_uri` is strictly validated (`https` required except localhost dev URLs).
