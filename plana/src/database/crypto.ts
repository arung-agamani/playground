import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Optional AES-256-GCM column encryption.
 * Enable with ENCRYPTION_KEY (64 hex chars = 32 bytes).
 * Ciphertext stored as: enc:v1:<base64(iv|tag|ciphertext)>
 */

const PREFIX = "enc:v1:";

let cachedKey: Buffer | null | undefined;

function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    cachedKey = null;
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes) when set",
    );
  }
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function encryptionEnabled(): boolean {
  return getKey() !== null;
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = getKey();
  if (!key) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]);
  return PREFIX + packed.toString("base64");
}

export function decrypt(value: string | null | undefined): string | null {
  if (value == null) return null;
  const key = getKey();
  if (!key || !value.startsWith(PREFIX)) return value;

  const packed = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const data = packed.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** Reset key cache (tests only). */
export function _resetEncryptionCache(): void {
  cachedKey = undefined;
}
