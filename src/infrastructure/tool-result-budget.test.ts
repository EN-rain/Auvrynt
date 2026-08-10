import assert from "node:assert/strict";
import {
  inlineImageOrNotice,
  limitToolResultPayload,
  MAX_INLINE_BINARY_BYTES,
} from "./tool-result-budget.js";

{
  const small = {
    content: [{ type: "text", text: "ok" }],
    _meta: { tool: "read", card: { summary: { lines: 1 } } },
    structuredContent: { result: "ok" },
  };
  assert.equal(limitToolResultPayload(small), small);
}

{
  const huge = "x".repeat(2 * 1024 * 1024);
  const limited = limitToolResultPayload({
    content: [{ type: "text", text: huge }],
    _meta: { tool: "read", card: { payload: { content: [{ type: "text", text: huge }] } } },
    structuredContent: { result: huge },
  });

  const serializedBytes = Buffer.byteLength(JSON.stringify(limited), "utf8");
  assert.ok(serializedBytes < 2.5 * 1024 * 1024, `serialized result was ${serializedBytes} bytes`);
  assert.match(JSON.stringify(limited), /Auvrynt truncated this tool result/);
  assert.match(JSON.stringify(limited), /\[truncated\]/);
}

{
  const structured = limitToolResultPayload({
    content: [{ type: "text", text: "ok" }],
    structuredContent: {
      requiredId: "workspace-1",
      items: Array.from({ length: 1_000 }, (_, index) => ({
        id: index,
        text: "q".repeat(2_048),
      })),
      requiredInstruction: "keep this field",
    },
  }) as {
    structuredContent: {
      requiredId: string;
      items: Array<{ id: number; text: string }>;
      requiredInstruction: string;
    };
  };
  assert.equal(structured.structuredContent.requiredId, "workspace-1");
  assert.equal(typeof structured.structuredContent.requiredInstruction, "string");
  assert.ok(structured.structuredContent.items.every((item) => typeof item.id === "number"));
}

{
  const binary = Buffer.alloc(MAX_INLINE_BINARY_BYTES + 1, 1).toString("base64");
  const limited = limitToolResultPayload({
    content: [{ type: "image", data: binary, mimeType: "image/png" }],
    _meta: { tool: "view_image", card: { payload: { content: [{ type: "image", data: binary }] } } },
  });
  const serialized = JSON.stringify(limited);
  assert.doesNotMatch(serialized, new RegExp(binary.slice(0, 128)));
  assert.match(serialized, /Inline image omitted/);
}

assert.equal(inlineImageOrNotice(Buffer.alloc(32), "small", "image/png")[0].type, "image");
assert.equal(
  inlineImageOrNotice(Buffer.alloc(MAX_INLINE_BINARY_BYTES + 1), "large", "image/png")[0].type,
  "text",
);

console.log("Tool result budget tests passed!");
