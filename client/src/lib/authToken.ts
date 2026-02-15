let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  const trimmed = token?.trim() ?? '';
  accessToken = trimmed.length > 0 ? trimmed : null;
}

export function clearLegacyPersistedAuth(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('auth-storage');
}
