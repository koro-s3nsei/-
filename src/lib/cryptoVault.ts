/**
 * Local Web Crypto API (AES-GCM 256-bit) Vault for encrypting user BYOK API keys
 * before saving them inside IndexedDB. Keeps plaintext credentials out of raw storage.
 */

const VAULT_SALT = 'alfaylasouf-mubasis-offline-vault-v1';

function getDeviceEntropy(): string {
  const parts = [
    typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
    typeof navigator !== 'undefined' ? navigator.language : 'ar',
    typeof location !== 'undefined' ? location.origin : 'local-apk',
    VAULT_SALT,
  ];
  return parts.join('|');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveVaultKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getDeviceEntropy()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(VAULT_SALT),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptLocalSecret(plainText: string): Promise<{
  cipherText: string;
  iv: string;
  lastFour: string;
}> {
  const trimmed = plainText.trim();
  const lastFour = trimmed.length >= 4 ? trimmed.slice(-4) : '****';

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return {
      cipherText: btoa(unescape(encodeURIComponent(trimmed))),
      iv: 'fallback-base64',
      lastFour,
    };
  }

  const key = await deriveVaultKey();
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(trimmed);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    encoded
  );

  return {
    cipherText: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(ivBytes),
    lastFour,
  };
}

export async function decryptLocalSecret(
  cipherText?: string,
  iv?: string
): Promise<string | null> {
  if (!cipherText || !iv) return null;

  if (iv === 'fallback-base64') {
    try {
      return decodeURIComponent(escape(atob(cipherText)));
    } catch {
      return null;
    }
  }

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }

  try {
    const key = await deriveVaultKey();
    const ivBytes = base64ToBytes(iv);
    const cipherBytes = base64ToBytes(cipherText);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes as BufferSource },
      key,
      cipherBytes as BufferSource
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    return null;
  }
}
