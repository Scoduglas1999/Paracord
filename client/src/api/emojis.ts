import { apiClient } from './client';
import type { GuildEmoji } from '../types';
import { buildGuildEmojiImageUrl } from '../lib/customEmoji';

const MAX_EMOJI_UPLOAD_BYTES = 256 * 1024;
const VALID_EMOJI_NAME = /^[A-Za-z0-9_]{1,32}$/;
const ALLOWED_EMOJI_TYPES = new Set(['image/png', 'image/gif']);

interface CreateEmojiRequest {
  name: string;
  file: File;
}

function assertValidEmojiName(name: string): string {
  const trimmed = name.trim();
  if (!VALID_EMOJI_NAME.test(trimmed)) {
    throw new Error('Emoji name must be 1-32 characters using letters, numbers, or underscore.');
  }
  return trimmed;
}

function assertValidEmojiFile(file: File): void {
  if (!ALLOWED_EMOJI_TYPES.has(file.type)) {
    throw new Error('Only PNG and GIF emoji uploads are supported.');
  }
  if (file.size <= 0 || file.size > MAX_EMOJI_UPLOAD_BYTES) {
    throw new Error('Emoji uploads must be between 1 byte and 256 KB.');
  }
}

export const emojiApi = {
  listGuild: (guildId: string) => apiClient.get<GuildEmoji[]>(`/guilds/${guildId}/emojis`),

  create: (guildId: string, data: CreateEmojiRequest) => {
    const name = assertValidEmojiName(data.name);
    assertValidEmojiFile(data.file);
    const formData = new FormData();
    formData.append('name', name);
    formData.append('image', data.file);
    return apiClient.post<GuildEmoji>(`/guilds/${guildId}/emojis`, formData);
  },

  update: (guildId: string, emojiId: string, name: string) =>
    apiClient.patch<GuildEmoji>(`/guilds/${guildId}/emojis/${emojiId}`, {
      name: assertValidEmojiName(name),
    }),

  delete: (guildId: string, emojiId: string) =>
    apiClient.delete(`/guilds/${guildId}/emojis/${emojiId}`),

  imageUrl: (guildId: string, emojiId: string) =>
    buildGuildEmojiImageUrl(guildId, emojiId),
};
