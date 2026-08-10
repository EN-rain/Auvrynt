import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertAllowedPath, expandHomePath, resolveAllowedPath } from "./roots.js";

const home = homedir();

assert.equal(expandHomePath("~"), home);
assert.equal(expandHomePath("~/personal/auvrynt"), resolve(home, "personal", "auvrynt"));
assert.equal(expandHomePath("~user/project"), "~user/project");
assert.equal(expandHomePath("$HOME/project"), "$HOME/project");

assert.equal(
  assertAllowedPath("~/personal/auvrynt", [join(home, "personal")]),
  resolve(home, "personal", "auvrynt"),
);

assert.equal(
  assertAllowedPath("~/personal/auvrynt", ["~/personal"]),
  resolve(home, "personal", "auvrynt"),
);

assert.equal(
  resolveAllowedPath("~/file.txt", "/workspace", ["/workspace"]),
  resolve("/workspace", "~/file.txt"),
);

const sandbox = mkdtempSync(join(tmpdir(), "auvrynt-roots-test-"));
try {
  const allowed = join(sandbox, "allowed");
  const outside = join(sandbox, "outside");
  const insideTarget = join(allowed, "real");
  mkdirSync(insideTarget, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(outside, join(allowed, "escape"), linkType);
  symlinkSync(insideTarget, join(allowed, "inside-link"), linkType);

  assert.throws(
    () => assertAllowedPath(join(allowed, "escape", "new.txt"), [allowed]),
    /outside allowed roots/i,
  );
  assert.equal(
    assertAllowedPath(join(allowed, "inside-link", "new.txt"), [allowed]),
    join(insideTarget, "new.txt"),
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
