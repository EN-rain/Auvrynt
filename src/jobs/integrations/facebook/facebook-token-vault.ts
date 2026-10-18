import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";
const FORMAT = "v1";

/**
 * Keeps provider access tokens out of the Jobs API and out of the SQLite
 * database in plaintext. The key is local to the Auvrynt state directory and
 * is created with restrictive permissions on platforms that support them.
 */
export class FacebookTokenVault {
  private readonly keyPath: string;

  constructor(private readonly stateDir: string) {
    this.keyPath = join(stateDir, ".facebook-token-key");
  }

  encrypt(accessToken: string): string {
    if (!accessToken || accessToken.length > 16_384) throw new Error("Invalid Facebook access token.");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  decrypt(value: string): string {
    const [format, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
    if (format !== FORMAT || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Invalid Facebook token record.");
    try {
      const iv = Buffer.from(encodedIv, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      const ciphertext = Buffer.from(encodedCiphertext, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid Facebook token record.");
      const decipher = createDecipheriv(ALGORITHM, this.key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Facebook token could not be decrypted.");
    }
  }

  private key(): Buffer {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    try { chmodSync(this.stateDir, 0o700); } catch { /* best effort on Windows */ }
    try {
      const descriptor = openSync(this.keyPath, "wx", 0o600);
      const key = randomBytes(KEY_BYTES);
      try { writeSync(descriptor, key, 0, key.length, 0); } finally { closeSync(descriptor); }
      try { chmodSync(this.keyPath, 0o600); } catch { /* best effort on Windows */ }
      return key;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    const key = readFileSync(this.keyPath);
    if (key.length !== KEY_BYTES) throw new Error("Invalid Facebook token key.");
    return key;
  }
}
