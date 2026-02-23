import { apiClient } from './client';

export interface StoreBot {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  icon_hash: string | null;
  install_count: number;
  bot_user_id: string;
  permissions: string;
}

export interface StoreBotSearchResult {
  bots: StoreBot[];
  total: number;
}

export interface StoreBotFeaturedResult {
  bots: StoreBot[];
}

export interface StoreBotCategoriesResult {
  categories: string[];
}

export const botStoreApi = {
  search: (params?: { q?: string; category?: string; limit?: number; offset?: number }) =>
    apiClient.get<StoreBotSearchResult>('/bots/store', { params }),
  featured: () =>
    apiClient.get<StoreBotFeaturedResult>('/bots/store/featured'),
  categories: () =>
    apiClient.get<StoreBotCategoriesResult>('/bots/store/categories'),
};
