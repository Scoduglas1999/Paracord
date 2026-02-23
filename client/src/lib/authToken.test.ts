import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLegacyPersistedAuth,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './authToken';

describe('authToken', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    setRefreshToken(null);
  });

  it('stores access token in memory only', () => {
    setAccessToken('  access-token  ');
    expect(getAccessToken()).toBe('access-token');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('stores and clears refresh token in localStorage', () => {
    setRefreshToken('refresh-token');
    expect(getRefreshToken()).toBe('refresh-token');

    setRefreshToken(null);
    expect(getRefreshToken()).toBeNull();
  });

  it('clears legacy auth keys without clearing refresh token', () => {
    localStorage.setItem('token', 'legacy-token');
    localStorage.setItem('auth-storage', '{"state":{}}');
    setRefreshToken('refresh-token');

    clearLegacyPersistedAuth();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('auth-storage')).toBeNull();
    expect(getRefreshToken()).toBe('refresh-token');
  });
});
