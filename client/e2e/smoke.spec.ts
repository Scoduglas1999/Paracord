import { expect, test } from '@playwright/test';

test('login -> guild -> message -> voice smoke flow', async ({ page }) => {
  const guildId = '1001';
  const textChannelId = '2001';
  const voiceChannelId = '2002';
  const nowIso = new Date().toISOString();

  const userPayload = {
    id: '42',
    username: 'smoke-user',
    discriminator: '0001',
    avatar_hash: null,
    bot: false,
    system: false,
    flags: 0,
    created_at: nowIso,
  };

  let messageCounter = 1;
  const messages: Array<Record<string, unknown>> = [];

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ service: 'paracord' }),
    });
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

    const json = (status: number, payload: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (path === '/api/v1/auth/refresh' && method === 'POST') {
      return json(401, { code: 'UNAUTHORIZED', message: 'No active session' });
    }
    if (path === '/api/v1/auth/login' && method === 'POST') {
      return json(200, { token: 'smoke-token', user: userPayload });
    }
    if (path === '/api/v1/users/@me' && method === 'GET') {
      return json(200, userPayload);
    }
    if (path === '/api/v1/users/@me/settings' && method === 'GET') {
      return json(200, {
        user_id: userPayload.id,
        theme: 'dark',
        locale: 'en-US',
        message_display_compact: false,
        custom_css: null,
        status: 'online',
        custom_status: null,
        crypto_auth_enabled: false,
        notifications: {},
        keybinds: {},
      });
    }
    if (path === '/api/v1/users/@me/guilds' && method === 'GET') {
      return json(200, [
        {
          id: guildId,
          name: 'QA Guild',
          icon_hash: null,
          owner_id: userPayload.id,
          member_count: 4,
          features: [],
          created_at: nowIso,
        },
      ]);
    }
    if (path === `/api/v1/guilds/${guildId}/channels` && method === 'GET') {
      return json(200, [
        {
          id: textChannelId,
          guild_id: guildId,
          name: 'general',
          type: 0,
          channel_type: 0,
          position: 0,
          nsfw: false,
          parent_id: null,
          required_role_ids: [],
          created_at: nowIso,
        },
        {
          id: voiceChannelId,
          guild_id: guildId,
          name: 'Voice Lounge',
          type: 2,
          channel_type: 2,
          position: 1,
          nsfw: false,
          parent_id: null,
          required_role_ids: [],
          created_at: nowIso,
        },
      ]);
    }
    if (path === `/api/v1/channels/${textChannelId}/messages` && method === 'GET') {
      return json(200, messages);
    }
    if (path === `/api/v1/channels/${textChannelId}/messages` && method === 'POST') {
      const payload = request.postDataJSON() as { content?: string };
      const message = {
        id: `${3000 + messageCounter++}`,
        channel_id: textChannelId,
        author: {
          id: userPayload.id,
          username: userPayload.username,
          discriminator: userPayload.discriminator,
          avatar_hash: null,
        },
        content: payload?.content ?? '',
        pinned: false,
        type: 0,
        message_type: 0,
        timestamp: nowIso,
        created_at: nowIso,
        edited_timestamp: null,
        edited_at: null,
        reference_id: null,
        attachments: [],
        reactions: [],
      };
      messages.push(message);
      return json(201, message);
    }
    if (path === `/api/v1/channels/${textChannelId}/typing` && method === 'POST') {
      return route.fulfill({ status: 204 });
    }
    if (path === `/api/v1/channels/${textChannelId}/read` && method === 'PUT') {
      return json(200, { channel_id: textChannelId, last_message_id: messages.at(-1)?.id ?? null, mention_count: 0 });
    }
    if (path === `/api/v1/channels/${voiceChannelId}/messages` && method === 'GET') {
      return json(200, []);
    }
    if (path === `/api/v1/guilds/${guildId}/members` && method === 'GET') {
      return json(200, []);
    }

    return json(404, { code: 'NOT_FOUND', message: `Unhandled mock route: ${method} ${path}` });
  });

  await page.goto('/login');
  await page.getByLabel('Email *').fill('qa@example.com');
  await page.getByLabel('Password *').fill('password123!');
  await page.getByRole('button', { name: 'Log In' }).click();

  await expect(page).toHaveURL(/\/app/);
  await page.getByRole('button', { name: /QA Guild/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/guilds/${guildId}/channels/${textChannelId}`));

  const composer = page.getByPlaceholder('Message #general');
  await composer.fill('e2e smoke message');
  await composer.press('Enter');
  await expect(page.getByText('e2e smoke message')).toBeVisible();

  await page.getByRole('button', { name: /Voice Lounge/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/guilds/${guildId}/channels/${voiceChannelId}`));
  await expect(
    page.getByText(/(Join from the channel rail to start speaking or screen sharing\.|Voice join failed:)/i),
  ).toBeVisible();
});
