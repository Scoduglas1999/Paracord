import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriEnv';

const webMemoryStore = new Map<string, string>();
const ENCRYPTED_FALLBACK_PREFIX = 'pcenc:v1:';
let hasWarnedSecureStorageDegrade = false;

function warnSecureStorageDegraded(): void {
  if (hasWarnedSecureStorageDegrade) {
    return;
  }
  hasWarnedSecureStorageDegrade = true;
  console.warn(
    'OS secure storage is unavailable; using encrypted local fallback storage for this profile.'
  );
  window.dispatchEvent(new CustomEvent('paracord:secure-storage-degraded'));
}

async function writeEncryptedFallback(key: string, value: string): Promise<void> {
  const encrypted = await invoke<string>('secure_store_fallback_encrypt', {
    plaintext: value,
  });
  localStorage.setItem(key, `${ENCRYPTED_FALLBACK_PREFIX}${encrypted}`);
}

async function readFallbackValue(key: string): Promise<string | null> {
  const stored = localStorage.getItem(key);
  if (stored === null) {
    return null;
  }
  if (!stored.startsWith(ENCRYPTED_FALLBACK_PREFIX)) {
    // Migrate any legacy plaintext fallback immediately.
    await writeEncryptedFallback(key, stored).catch(() => {
      webMemoryStore.set(key, stored);
      localStorage.removeItem(key);
    });
    return stored;
  }

  const payload = stored.slice(ENCRYPTED_FALLBACK_PREFIX.length);
  if (!payload) {
    return null;
  }
  return invoke<string>('secure_store_fallback_decrypt', { payload });
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    webMemoryStore.set(key, value);
    localStorage.removeItem(key);
    return;
  }
  try {
    await invoke('secure_store_set', { key, value });
    localStorage.removeItem(key);
  } catch {
    warnSecureStorageDegraded();
    await writeEncryptedFallback(key, value).catch(() => {
      webMemoryStore.set(key, value);
      localStorage.removeItem(key);
    });
  }
}

export async function secureGet(key: string): Promise<string | null> {
  if (!isTauri()) {
    return webMemoryStore.get(key) ?? null;
  }
  try {
    const value = await invoke<string | null>('secure_store_get', { key });
    if (value !== null && value !== undefined) {
      return value;
    }
  } catch {
    warnSecureStorageDegraded();
  }
  const fallback = await readFallbackValue(key).catch(() => null);
  if (fallback !== null) {
    return fallback;
  }
  return webMemoryStore.get(key) ?? null;
}

export async function secureDelete(key: string): Promise<void> {
  if (!isTauri()) {
    webMemoryStore.delete(key);
    localStorage.removeItem(key);
    return;
  }
  try {
    await invoke('secure_store_delete', { key });
  } catch {
    // Best-effort delete.
  }
  localStorage.removeItem(key);
}
