import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  encrypt,
  decrypt,
  encryptionEnabled,
  _resetEncryptionCache,
} from "./crypto";

describe("column encryption", () => {
  const prev = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    _resetEncryptionCache();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prev;
    _resetEncryptionCache();
  });

  test("round-trips plaintext", () => {
    expect(encryptionEnabled()).toBe(true);
    const ct = encrypt("secret message");
    expect(ct).toStartWith("enc:v1:");
    expect(decrypt(ct)).toBe("secret message");
  });

  test("passthrough when key unset", () => {
    delete process.env.ENCRYPTION_KEY;
    _resetEncryptionCache();
    expect(encryptionEnabled()).toBe(false);
    expect(encrypt("plain")).toBe("plain");
    expect(decrypt("plain")).toBe("plain");
  });

  test("does not double-encrypt", () => {
    const once = encrypt("a")!;
    const twice = encrypt(once)!;
    expect(twice).toBe(once);
  });
});
