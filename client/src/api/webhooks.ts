import { apiClient } from './client';
import type { Webhook } from '../types';

interface CreateWebhookRequest {
  name: string;
  channel_id?: string;
}

interface UpdateWebhookRequest {
  name?: string;
}

interface ExecuteWebhookRequest {
  content: string;
  username?: string;
  avatar_url?: string;
}

export const webhookApi = {
  create: (guildId: string, data: CreateWebhookRequest) =>
    apiClient.post<Webhook>(`/guilds/${guildId}/webhooks`, data),
  listGuild: (guildId: string) => apiClient.get<Webhook[]>(`/guilds/${guildId}/webhooks`),
  listChannel: (channelId: string) => apiClient.get<Webhook[]>(`/channels/${channelId}/webhooks`),
  get: (webhookId: string) => apiClient.get<Webhook>(`/webhooks/${webhookId}`),
  update: (webhookId: string, data: UpdateWebhookRequest) =>
    apiClient.patch<Webhook>(`/webhooks/${webhookId}`, data),
  delete: (webhookId: string) => apiClient.delete(`/webhooks/${webhookId}`),
  execute: (webhookId: string, token: string, data: ExecuteWebhookRequest) =>
    apiClient.post(`/webhooks/${webhookId}/${token}`, data),
};
