import { apiClient } from './client';
import type {
  Channel,
  EditMessageRequest,
  ForumPostsResponse,
  ForumTag,
  Message,
  PaginationParams,
  Poll,
  SendMessageRequest,
} from '../types';

interface CreateThreadRequest {
  name: string;
  message_id?: string;
  auto_archive_duration?: number;
}

interface UpdateThreadRequest {
  name?: string;
  archived?: boolean;
  locked?: boolean;
}

interface CreatePollOptionRequest {
  text: string;
  emoji?: string;
}

interface CreatePollRequest {
  question: string;
  options: CreatePollOptionRequest[];
  allow_multiselect?: boolean;
  expires_in_minutes?: number;
}

export const channelApi = {
  get: (id: string) => apiClient.get<Channel>(`/channels/${id}`),
  update: (id: string, data: Partial<Channel>) => apiClient.patch<Channel>(`/channels/${id}`, data),
  delete: (id: string) => apiClient.delete(`/channels/${id}`),

  getMessages: (id: string, params?: PaginationParams) =>
    apiClient.get<Message[]>(`/channels/${id}/messages`, { params }),
  searchMessages: (id: string, q: string, limit = 20) =>
    apiClient.get<Message[]>(`/channels/${id}/messages/search`, { params: { q, limit } }),
  bulkDeleteMessages: (id: string, messageIds: string[]) =>
    apiClient.post<{ deleted: number }>(`/channels/${id}/messages/bulk-delete`, { message_ids: messageIds }),
  sendMessage: (id: string, data: SendMessageRequest) =>
    apiClient.post<Message>(`/channels/${id}/messages`, data),
  editMessage: (channelId: string, messageId: string, data: EditMessageRequest) =>
    apiClient.patch<Message>(`/channels/${channelId}/messages/${messageId}`, data),
  deleteMessage: (channelId: string, messageId: string) =>
    apiClient.delete(`/channels/${channelId}/messages/${messageId}`),

  getPins: (id: string) => apiClient.get<Message[]>(`/channels/${id}/pins`),
  pinMessage: (channelId: string, messageId: string) =>
    apiClient.put(`/channels/${channelId}/pins/${messageId}`),
  unpinMessage: (channelId: string, messageId: string) =>
    apiClient.delete(`/channels/${channelId}/pins/${messageId}`),

  addReaction: (channelId: string, messageId: string, emoji: string) =>
    apiClient.put(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    ),
  removeReaction: (channelId: string, messageId: string, emoji: string) =>
    apiClient.delete(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    ),

  triggerTyping: (id: string) => apiClient.post(`/channels/${id}/typing`),
  updateReadState: (id: string, lastMessageId?: string) =>
    apiClient.put(`/channels/${id}/read`, { last_message_id: lastMessageId }),

  updatePositions: (guildId: string, positions: { id: string; position: number; parent_id?: string | null }[]) =>
    apiClient.patch<{ updated: number }>(`/guilds/${guildId}/channels`, positions),

  createThread: (channelId: string, data: CreateThreadRequest) =>
    apiClient.post<Channel>(`/channels/${channelId}/threads`, data),
  getThreads: (channelId: string) =>
    apiClient.get<Channel[]>(`/channels/${channelId}/threads`),
  getArchivedThreads: (channelId: string) =>
    apiClient.get<Channel[]>(`/channels/${channelId}/threads/archived`),
  updateThread: (channelId: string, threadId: string, data: UpdateThreadRequest) =>
    apiClient.patch<Channel>(`/channels/${channelId}/threads/${threadId}`, data),
  deleteThread: (channelId: string, threadId: string) =>
    apiClient.delete(`/channels/${channelId}/threads/${threadId}`),

  createPoll: (channelId: string, data: CreatePollRequest) =>
    apiClient.post<Message>(`/channels/${channelId}/polls`, data),
  getPoll: (channelId: string, pollId: string) =>
    apiClient.get<Poll>(`/channels/${channelId}/polls/${pollId}`),
  addPollVote: (channelId: string, pollId: string, optionId: string) =>
    apiClient.put<Poll>(`/channels/${channelId}/polls/${pollId}/votes/${optionId}`),
  removePollVote: (channelId: string, pollId: string, optionId: string) =>
    apiClient.delete<Poll>(`/channels/${channelId}/polls/${pollId}/votes/${optionId}`),

  // Forum
  getForumPosts: (channelId: string, params?: { sort_order?: number; include_archived?: boolean }) =>
    apiClient.get<ForumPostsResponse>(`/channels/${channelId}/forum/posts`, { params }),
  createForumPost: (channelId: string, data: { name: string; content?: string; applied_tag_ids?: string[] }) =>
    apiClient.post<Channel>(`/channels/${channelId}/forum/posts`, data),
  getForumTags: (channelId: string) =>
    apiClient.get<ForumTag[]>(`/channels/${channelId}/forum/tags`),
  createForumTag: (channelId: string, data: { name: string; emoji?: string; moderated?: boolean }) =>
    apiClient.post<ForumTag>(`/channels/${channelId}/forum/tags`, data),
  deleteForumTag: (channelId: string, tagId: string) =>
    apiClient.delete(`/channels/${channelId}/forum/tags/${tagId}`),
  updateForumSortOrder: (channelId: string, sortOrder: number) =>
    apiClient.patch(`/channels/${channelId}/forum/sort`, { sort_order: sortOrder }),
};
