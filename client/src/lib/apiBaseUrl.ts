/**
 * Resolve the API base URL.
 *
 * Priority:
 *   1. `?api_base=<url>` query parameter (persisted to localStorage)
 *   2. `VITE_API_URL` env variable
 *   3. Stored server URL from the connect screen (`paracord:server-url`)
 *   4. Relative `/api/v1` (works with the Vite dev proxy and production alike)
 */

export const SERVER_URL_KEY = 'paracord:server-url';

export function getStoredServerUrl(): string | null {
  try {
    return window.localStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
}

/**
 * Returns the current browser origin as a server URL when running from a
 * deployed Paracord server. Skips local dev to avoid pinning Vite origins.
 */
export function getCurrentOriginServerUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (import.meta.env.DEV) return null;
  if (!/^https?:$/.test(window.location.protocol)) return null;
  if (!window.location.host) return null;
  return `${window.location.protocol}//${window.location.host}`;
}

export function setStoredServerUrl(url: string): void {
  window.localStorage.setItem(SERVER_URL_KEY, url);
}

export function clearStoredServerUrl(): void {
  window.localStorage.removeItem(SERVER_URL_KEY);
}

function getRuntimeApiBaseUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const legacyKey = 'paracord:api-base-url';
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('api_base');
    if (fromQuery) {
      window.localStorage.setItem(legacyKey, fromQuery);
      return fromQuery;
    }
    const fromStorage = window.localStorage.getItem(legacyKey);
    if (fromStorage) {
      return fromStorage;
    }
  } catch {
    // Ignore malformed URL edge cases and fall back to env/default.
  }
  return null;
}

export function resolveApiBaseUrl(): string {
  // 1. Legacy query-param / localStorage override
  const runtime = getRuntimeApiBaseUrl();
  if (runtime) return runtime;

  // 2. Env variable
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // 3. Stored server URL from connect screen
  const serverUrl = getStoredServerUrl();
  if (serverUrl) {
    // Strip trailing slash and append /api/v1
    return `${serverUrl.replace(/\/+$/, '')}/api/v1`;
  }

  // 4. Relative path (same origin / Vite dev proxy)
  return '/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();
