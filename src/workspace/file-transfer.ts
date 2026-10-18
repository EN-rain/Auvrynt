import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

export const MAX_TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSFER_FILE_BYTES = 64 * 1024 * 1024;

export interface FileTransferChunkInput {
  absolutePath: string;
  dataBase64: string;
  offset?: number;
  overwrite?: boolean;
  final?: boolean;
  expectedSha256?: string;
  mimeType?: string;
}

export interface FileTransferChunkResult {
  bytesWritten: number;
  sizeBytes: number;
  nextOffset: number;
  final: boolean;
  sha256?: string;
  mimeType?: string;
}

export async function writeFileTransferChunk(input: FileTransferChunkInput): Promise<FileTransferChunkResult> {
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("File transfer offset must be a non-negative safe integer");
  }
  if (offset > 0 && input.overwrite) {
    throw new Error("overwrite may only be used for the first file-transfer chunk");
  }

  const decoded = decodeTransferPayload(input.dataBase64, input.mimeType);
  if (decoded.buffer.length > MAX_TRANSFER_CHUNK_BYTES) {
    throw new Error(`File transfer chunk exceeds ${MAX_TRANSFER_CHUNK_BYTES} bytes`);
  }
  if (offset + decoded.buffer.length > MAX_TRANSFER_FILE_BYTES) {
    throw new Error(`Transferred file exceeds ${MAX_TRANSFER_FILE_BYTES} bytes`);
  }

  await mkdir(dirname(input.absolutePath), { recursive: true });
  if (offset === 0) {
    const exists = await fileExists(input.absolutePath);
    if (exists && !input.overwrite) {
      throw new Error("Destination file already exists; pass overwrite=true to replace it");
    }
    const handle = await open(input.absolutePath, input.overwrite ? "w" : "wx");
    try {
      await writeAll(handle, decoded.buffer, 0);
    } finally {
      await handle.close();
    }
  } else {
    const current = await stat(input.absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("Cannot append a file-transfer chunk before the first chunk");
      throw error;
    });
    if (!current.isFile()) throw new Error("File-transfer destination is not a regular file");
    if (current.size !== offset) {
      throw new Error(`File transfer offset mismatch: expected ${current.size}, received ${offset}`);
    }
    const handle = await open(input.absolutePath, "r+");
    try {
      await writeAll(handle, decoded.buffer, offset);
    } finally {
      await handle.close();
    }
  }

  const sizeBytes = offset + decoded.buffer.length;
  const final = input.final ?? true;
  if (!final) {
    return {
      bytesWritten: decoded.buffer.length,
      sizeBytes,
      nextOffset: sizeBytes,
      final: false,
      mimeType: decoded.mimeType,
    };
  }

  const sha256 = offset === 0
    ? createHash("sha256").update(decoded.buffer).digest("hex")
    : await hashFile(input.absolutePath);
  const expected = input.expectedSha256?.trim().toLowerCase();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("expectedSha256 must be a 64-character hexadecimal SHA-256 digest");
  }
  if (expected && sha256 !== expected) {
    throw new Error(`Transferred file SHA-256 mismatch: expected ${expected}, received ${sha256}`);
  }

  return {
    bytesWritten: decoded.buffer.length,
    sizeBytes,
    nextOffset: sizeBytes,
    final: true,
    sha256,
    mimeType: decoded.mimeType,
  };
}

export function decodeTransferPayload(dataBase64: string, requestedMimeType?: string): {
  buffer: Buffer;
  mimeType?: string;
} {
  let encoded = dataBase64.trim();
  let dataUrlMimeType: string | undefined;
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(encoded);
  if (dataUrl) {
    dataUrlMimeType = dataUrl[1]!.trim().toLowerCase();
    encoded = dataUrl[2]!;
  }
  encoded = encoded.replace(/\s+/g, "");
  if (!encoded) throw new Error("File transfer payload must not be empty");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("File transfer payload is not valid base64");
  }

  assertCanonicalBase64(encoded);
  const buffer = Buffer.from(encoded, "base64");

  const normalizedMimeType = requestedMimeType?.trim().toLowerCase() || undefined;
  if (dataUrlMimeType && normalizedMimeType && dataUrlMimeType !== normalizedMimeType) {
    throw new Error(`File transfer MIME type mismatch: data URL is ${dataUrlMimeType}, requested ${normalizedMimeType}`);
  }
  return { buffer, mimeType: dataUrlMimeType ?? normalizedMimeType };
}

function assertCanonicalBase64(encoded: string): void {
  const paddingMatch = /=+$/.exec(encoded);
  const padding = paddingMatch?.[0].length ?? 0;
  const unpadded = padding > 0 ? encoded.slice(0, -padding) : encoded;
  const remainder = unpadded.length % 4;
  if (remainder === 1) throw new Error("File transfer payload is not valid base64");

  if (padding > 0) {
    const expectedPadding = remainder === 2 ? 2 : remainder === 3 ? 1 : 0;
    if (padding !== expectedPadding || encoded.length % 4 !== 0) {
      throw new Error("File transfer payload is not canonical base64");
    }
  }

  if (remainder === 0 || unpadded.length === 0) return;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lastValue = alphabet.indexOf(unpadded.at(-1)!);
  if (lastValue < 0) throw new Error("File transfer payload is not valid base64");
  if ((remainder === 2 && (lastValue & 0x0f) !== 0) || (remainder === 3 && (lastValue & 0x03) !== 0)) {
    throw new Error("File transfer payload is not canonical base64");
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  startPosition: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, startPosition + written);
    if (result.bytesWritten <= 0) throw new Error("File transfer write made no progress");
    written += result.bytesWritten;
  }
}
