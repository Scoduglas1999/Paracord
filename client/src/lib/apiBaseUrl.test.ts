import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('apiBaseUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('getStoredServerUrl', () => {
    it('returns null when nothing is stored', async () => {
      const { getStoredServerUrl } = await import('./apiBaseUrl');
      expect(getStoredServerUrl()).toBeNull();
    });

    it('returns stored value', async () => {
      localStorage.setItem('paracord:server-url', 'https://my-server.com');
      const { getStoredServerUrl } = await import('./apiBaseUrl');
      expect(getStoredServerUrl()).toBe('https://my-server.com');
    });
  });

  describe('setStoredServerUrl', () => {
    it('stores the URL', async () => {
      const { setStoredServerUrl, getStoredServerUrl } = await import('./apiBaseUrl');
      setStoredServerUrl('https://example.com');
      expect(getStoredServerUrl()).toBe('https://example.com');
      expect(localStorage.getItem('paracord:server-url')).toBe('https://example.com');
    });
  });

  describe('clearStoredServerUrl', () => {
    it('removes the stored URL', async () => {
      const { setStoredServerUrl, clearStoredServerUrl, getStoredServerUrl } = await import('./apiBaseUrl');
      setStoredServerUrl('https://example.com');
      clearStoredServerUrl();
      expect(getStoredServerUrl()).toBeNull();
    });
  });

  describe('getCurrentOriginServerUrl', () => {
    it('returns null when import.meta.env.DEV is true', async () => {
      vi.stubEnv('DEV', true);
      const mod = await import('./apiBaseUrl');
      expect(mod.getCurrentOriginServerUrl()).toBeNull();
    });
  });

  describe('SERVER_URL_KEY', () => {
    it('equals the expected constant', async () => {
      const { SERVER_URL_KEY } = await import('./apiBaseUrl');
      expect(SERVER_URL_KEY).toBe('paracord:server-url');
    });
  });

  describe('resolveApiBaseUrl', () => {
    it('returns /api/v1 when no overrides are set', async () => {
      vi.stubEnv('VITE_API_URL', '');
      const { resolveApiBaseUrl } = await import('./apiBaseUrl');
      const result = resolveApiBaseUrl();
      expect(result).toBe('/api/v1');
    });

    it('returns VITE_API_URL when set', async () => {
      vi.stubEnv('VITE_API_URL', 'https://api.example.com');
      vi.resetModules();
      const mod = await import('./apiBaseUrl');
      expect(mod.resolveApiBaseUrl()).toBe('https://api.example.com');
    });

    it('returns stored server URL with /api/v1 appended', async () => {
      vi.stubEnv('VITE_API_URL', '');
      localStorage.setItem('paracord:server-url', 'https://myserver.com');
      vi.resetModules();
      const mod = await import('./apiBaseUrl');
      expect(mod.resolveApiBaseUrl()).toBe('https://myserver.com/api/v1');
    });

    it('strips trailing slash from stored server URL', async () => {
      vi.stubEnv('VITE_API_URL', '');
      localStorage.setItem('paracord:server-url', 'https://myserver.com/');
      vi.resetModules();
      const mod = await import('./apiBaseUrl');
      expect(mod.resolveApiBaseUrl()).toBe('https://myserver.com/api/v1');
    });
  });
});
