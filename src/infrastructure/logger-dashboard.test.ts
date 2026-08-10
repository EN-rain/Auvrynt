import assert from "node:assert/strict";
import {
  logEvent,
  recentLogEntries,
  type LoggingConfig,
} from "./logger.js";

const originalStartMode = process.env.AUVRYNT_START_MODE;
const originalEmitter = (global as any).auvryntLogEmitter;
const logging: LoggingConfig = {
  level: "debug",
  format: "json",
  requests: true,
  assets: false,
  toolCalls: true,
  shellCommands: false,
};

try {
  process.env.AUVRYNT_START_MODE = "true";
  (global as any).auvryntLogEmitter = () => undefined;
  logEvent(logging, "warn", "dashboard_log_test", {
    workspace: "C:\\workspace",
    ip: "127.0.0.1",
    endpoint: "http://203.0.113.10:49321/mcp",
    authorization: "Bearer secret-value",
    nested: { accessToken: "secret-token", remoteAddress: "::1", safe: "visible" },
  });

  const latest = recentLogEntries(1)[0];
  assert.ok(Number.isInteger(latest.id));
  assert.equal(latest.event, "dashboard_log_test");
  assert.equal(latest.level, "warn");
  assert.equal(latest.fields.workspace, "C:\\workspace");
  assert.equal(latest.fields.ip, "[network-address]");
  assert.equal(latest.fields.endpoint, "http://[network-address]/mcp");
  assert.equal(latest.fields.authorization, "[redacted]");
  assert.deepEqual(latest.fields.nested, {
    accessToken: "[redacted]",
    remoteAddress: "[network-address]",
    safe: "visible",
  });
  assert.doesNotMatch(JSON.stringify(latest), /127\.0\.0\.1|203\.0\.113\.10|::1/);
} finally {
  if (originalStartMode === undefined) delete process.env.AUVRYNT_START_MODE;
  else process.env.AUVRYNT_START_MODE = originalStartMode;
  if (originalEmitter === undefined) delete (global as any).auvryntLogEmitter;
  else (global as any).auvryntLogEmitter = originalEmitter;
}
