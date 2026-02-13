import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserSettings } from '../types';
import { authApi } from '../api/auth';

interface AuthState {
  token: string | null;
  user: User | null;
  settings: UserSettings | null;
  hasFetchedSettings: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (data: Partial<UserSettings>) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      settings: null,
      hasFetchedSettings: false,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await authApi.login({ email, password });
          localStorage.setItem('token', data.token);
          set({ token: data.token, user: data.user, isLoading: false });
        } catch (err: unknown) {
          const message =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
            'Login failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      register: async (email, username, password, displayName) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await authApi.register({
            email,
            username,
            password,
            display_name: displayName || undefined,
          });
          localStorage.setItem('token', data.token);
          set({ token: data.token, user: data.user, isLoading: false });
        } catch (err: unknown) {
          const message =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
            'Registration failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      logout: () => {
        localStorage.removeItem('token');
        set({ token: null, user: null, settings: null, hasFetchedSettings: false });
      },

      fetchUser: async () => {
        try {
          const { data } = await authApi.getMe();
          set({ user: data });
        } catch {
          /* ignore */
        }
      },

      updateUser: async (userData) => {
        const { data } = await authApi.updateMe(userData);
        set({ user: data });
      },

      fetchSettings: async () => {
        try {
          const { data } = await authApi.getSettings();
          set({ settings: data, hasFetchedSettings: true });
        } catch {
          set({ hasFetchedSettings: true });
        }
      },

      updateSettings: async (settingsData) => {
        const { data } = await authApi.updateSettings(settingsData);
        set({ settings: data, hasFetchedSettings: true });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
);
