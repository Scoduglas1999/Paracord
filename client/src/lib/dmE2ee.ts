import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { MessageE2eePayload } from '../types';

const DM_E2EE_VERSION = 1;
const AES_GCM_NONCE_BYTES = 12;
const DM_E2EE_CONTEXT_PREFIX = 'paracord:dm-e2ee:v1:';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : (new Uint8Array(bytes).buffer as ArrayBuffer);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function deriveConversationKeyMaterial(
  channelId: string,
  myPrivateKeyEd25519: Uint8Array,
  peerPublicKeyEd25519Hex: string,
): Uint8Array {
  const myPrivateX25519 = ed25519.utils.toMontgomerySecret(myPrivateKeyEd25519);
  const peerPublicEd25519 = hexToBytes(peerPublicKeyEd25519Hex);
  const peerPublicX25519 = ed25519.utils.toMontgomery(peerPublicEd25519);
  const sharedSecret = x25519.getSharedSecret(myPrivateX25519, peerPublicX25519);
  const context = utf8ToBytes(`${DM_E2EE_CONTEXT_PREFIX}${channelId}`);
  return sha256(concatBytes(context, sharedSecret));
}

async function deriveConversationKey(
  channelId: string,
  myPrivateKeyEd25519: Uint8Array,
  peerPublicKeyEd25519Hex: string,
): Promise<CryptoKey> {
  const keyMaterial = deriveConversationKeyMaterial(
    channelId,
    myPrivateKeyEd25519,
    peerPublicKeyEd25519Hex,
  );
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyMaterial),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptDmMessage(
  channelId: string,
  plaintext: string,
  myPrivateKeyEd25519: Uint8Array,
  peerPublicKeyEd25519Hex: string,
): Promise<MessageE2eePayload> {
  const key = await deriveConversationKey(
    channelId,
    myPrivateKeyEd25519,
    peerPublicKeyEd25519Hex,
  );
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const plaintextBytes = utf8ToBytes(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(plaintextBytes),
  );
  return {
    version: DM_E2EE_VERSION,
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptDmMessage(
  channelId: string,
  payload: MessageE2eePayload,
  myPrivateKeyEd25519: Uint8Array,
  peerPublicKeyEd25519Hex: string,
): Promise<string> {
  if (payload.version !== DM_E2EE_VERSION) {
    throw new Error('Unsupported DM E2EE version');
  }
  const key = await deriveConversationKey(
    channelId,
    myPrivateKeyEd25519,
    peerPublicKeyEd25519Hex,
  );
  const nonce = fromBase64(payload.nonce);
  if (nonce.length !== AES_GCM_NONCE_BYTES) {
    throw new Error('Invalid DM E2EE nonce');
  }
  const ciphertext = fromBase64(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
