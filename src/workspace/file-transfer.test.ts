import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeTransferPayload,
  MAX_TRANSFER_CHUNK_BYTES,
  writeFileTransferChunk,
} from "./file-transfer.js";

const root = mkdtempSync(join(tmpdir(), "auvrynt-file-transfer-"));

try {
  const bytes = Buffer.from("generated-image-bytes");
  const encoded = bytes.toString("base64");
  const dataUrl = `data:image/png;base64,${encoded}`;
  const decoded = decodeTransferPayload(dataUrl, "image/png");
  assert.deepEqual(decoded.buffer, bytes);
  assert.equal(decoded.mimeType, "image/png");
  assert.throws(() => decodeTransferPayload(dataUrl, "image/jpeg"), /MIME type mismatch/);
  assert.throws(() => decodeTransferPayload("not base64%%%"), /valid base64/);
  assert.throws(() => decodeTransferPayload("AB=="), /canonical base64/);
  assert.throws(() => decodeTransferPayload("AAB="), /canonical base64/);
  assert.deepEqual(decodeTransferPayload("AA").buffer, Buffer.from([0]));
  assert.equal(MAX_TRANSFER_CHUNK_BYTES, 8 * 1024 * 1024);

  const singlePath = join(root, "single.png");
  const single = await writeFileTransferChunk({
    absolutePath: singlePath,
    dataBase64: dataUrl,
    mimeType: "image/png",
  });
  assert.equal(single.final, true);
  assert.equal(single.sizeBytes, bytes.length);
  assert.equal(single.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(readFileSync(singlePath), bytes);
  await assert.rejects(
    () => writeFileTransferChunk({ absolutePath: singlePath, dataBase64: encoded }),
    /already exists/,
  );

  const chunkedPath = join(root, "chunked.bin");
  const firstBytes = Buffer.from("first-");
  const secondBytes = Buffer.from("second");
  const first = await writeFileTransferChunk({
    absolutePath: chunkedPath,
    dataBase64: firstBytes.toString("base64"),
    final: false,
  });
  assert.equal(first.final, false);
  assert.equal(first.nextOffset, firstBytes.length);
  await assert.rejects(
    () => writeFileTransferChunk({
      absolutePath: chunkedPath,
      dataBase64: secondBytes.toString("base64"),
      offset: first.nextOffset + 1,
    }),
    /offset mismatch/,
  );
  const expected = Buffer.concat([firstBytes, secondBytes]);
  const expectedSha256 = createHash("sha256").update(expected).digest("hex");
  const second = await writeFileTransferChunk({
    absolutePath: chunkedPath,
    dataBase64: secondBytes.toString("base64"),
    offset: first.nextOffset,
    expectedSha256,
  });
  assert.equal(second.final, true);
  assert.equal(second.sha256, expectedSha256);
  assert.deepEqual(readFileSync(chunkedPath), expected);

  const overwritePath = join(root, "overwrite.bin");
  writeFileSync(overwritePath, "old");
  await writeFileTransferChunk({
    absolutePath: overwritePath,
    dataBase64: Buffer.from("new").toString("base64"),
    overwrite: true,
  });
  assert.equal(readFileSync(overwritePath, "utf8"), "new");

  const tooLarge = Buffer.alloc(MAX_TRANSFER_CHUNK_BYTES + 1).toString("base64");
  await assert.rejects(
    () => writeFileTransferChunk({ absolutePath: join(root, "too-large.bin"), dataBase64: tooLarge }),
    /chunk exceeds/,
  );

  console.log("File transfer tests passed!");
} finally {
  rmSync(root, { recursive: true, force: true });
}
