import { generateRecoveryPhrase, signChallenge } from './account';

let unlockedPrivateKey: Uint8Array | null = null;

function requireUnlockedPrivateKey(): Uint8Array {
  if (!unlockedPrivateKey) {
    throw new Error('Account not unlocked');
  }
  return unlockedPrivateKey;
}

export function setUnlockedPrivateKey(privateKey: Uint8Array): void {
  if (unlockedPrivateKey) {
    unlockedPrivateKey.fill(0);
  }
  unlockedPrivateKey = new Uint8Array(privateKey);
  privateKey.fill(0);
}

export function clearUnlockedPrivateKey(): void {
  if (unlockedPrivateKey) {
    unlockedPrivateKey.fill(0);
  }
  unlockedPrivateKey = null;
}

export function hasUnlockedPrivateKey(): boolean {
  return unlockedPrivateKey !== null;
}

export async function signServerChallengeWithUnlockedKey(
  nonce: string,
  timestamp: number,
  serverOrigin: string,
): Promise<string> {
  return signChallenge(requireUnlockedPrivateKey(), nonce, timestamp, serverOrigin);
}

export function getRecoveryPhraseFromUnlockedKey(): string | null {
  if (!unlockedPrivateKey) return null;
  return generateRecoveryPhrase(unlockedPrivateKey);
}

export async function withUnlockedPrivateKey<T>(
  run: (privateKey: Uint8Array) => Promise<T>,
): Promise<T> {
  return run(requireUnlockedPrivateKey());
}
