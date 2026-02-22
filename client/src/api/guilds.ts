import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';
import type {
  Guild,
  Channel,
  Member,
  Role,
  Invite,
  Ban,
  AuditLogEntry,
  CreateGuildRequest,
  CreateChannelRequest,
  CreateRoleRequest,
  CreateInviteRequest,
  UpdateMemberRequest,
} from '../types';

export const guildApi = {
  getAll: () => apiClient.get<Guild[]>('/users/@me/guilds'),
  create: (data: CreateGuildRequest) => apiClient.post<Guild>('/guilds', data),
  get: (id: string) => apiClient.get<Guild>(`/guilds/${id}`),
  update: (id: string, data: Partial<Guild>) => apiClient.patch<Guild>(`/guilds/${id}`, data),
  delete: (id: string) => apiClient.delete(`/guilds/${id}`),
  transferOwnership: (id: string, newOwnerId: string) =>
    apiClient.post(`/guilds/${id}/owner`, { new_owner_id: newOwnerId }),

  getChannels: (id: string, config?: AxiosRequestConfig) =>
    apiClient.get<Channel[]>(`/guilds/${id}/channels`, config),
  createChannel: (id: string, data: CreateChannelRequest) =>
    apiClient.post<Channel>(`/guilds/${id}/channels`, data),

  getMembers: (id: string) => apiClient.get<Member[]>(`/guilds/${id}/members`),
  updateMember: (guildId: string, userId: string, data: UpdateMemberRequest) =>
    apiClient.patch<Member>(`/guilds/${guildId}/members/${userId}`, data),
  kickMember: (guildId: string, userId: string) =>
    apiClient.delete(`/guilds/${guildId}/members/${userId}`),
  leaveGuild: (id: string) => apiClient.delete(`/guilds/${id}/members/@me`),

  getRoles: (id: string) => apiClient.get<Role[]>(`/guilds/${id}/roles`),
  createRole: (id: string, data: CreateRoleRequest) =>
    apiClient.post<Role>(`/guilds/${id}/roles`, data),
  updateRole: (guildId: string, roleId: string, data: Partial<Role>) =>
    apiClient.patch<Role>(`/guilds/${guildId}/roles/${roleId}`, data),
  deleteRole: (guildId: string, roleId: string) =>
    apiClient.delete(`/guilds/${guildId}/roles/${roleId}`),

  getBans: (id: string) => apiClient.get<Ban[]>(`/guilds/${id}/bans`),
  banMember: (guildId: string, userId: string, reason?: string) =>
    apiClient.put(`/guilds/${guildId}/bans/${userId}`, { reason }),
  unbanMember: (guildId: string, userId: string) =>
    apiClient.delete(`/guilds/${guildId}/bans/${userId}`),

  getInvites: (id: string) => apiClient.get<Invite[]>(`/guilds/${id}/invites`),
  createInvite: (channelId: string, data?: CreateInviteRequest) =>
    apiClient.post<Invite>(`/channels/${channelId}/invites`, data),

  getAuditLog: (id: string, params?: Record<string, string>) =>
    apiClient.get<{ audit_log_entries: AuditLogEntry[] }>(`/guilds/${id}/audit-logs`, { params }),
};
