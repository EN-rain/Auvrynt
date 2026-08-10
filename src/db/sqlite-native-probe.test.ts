import assert from "node:assert/strict";
import { checkSqliteNative } from "./cli/commands/status-commands.js";

assert.equal(
  checkSqliteNative(),
  "ok",
  "SQLite readiness must verify that the native binding can open and query a database",
);
