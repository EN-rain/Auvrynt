import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearKritaShortcutPersistence,
  configureKritaShortcutPersistence,
  getKritaShortcutProfile,
  markKritaShortcutsValidated,
  prepareKritaShortcuts,
  setKritaShortcutBinding,
} from "./krita-shortcuts.js";
import {
  createKritaInstallationFingerprint,
  createKritaShortcutBindingFingerprint,
} from "./krita-shortcut-fingerprint.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-krita-shortcuts-"));
configureKritaShortcutPersistence(root);
clearKritaShortcutPersistence();
const installation = createKritaInstallationFingerprint({ executablePath: "krita.exe", executableVersion: "5.2", keyboardLayout: "en-US" });
setKritaShortcutBinding("first-session", "new_layer", ["INSERT"]);
markKritaShortcutsValidated("first-session", ["new_layer"], installation);
assert.equal(getKritaShortcutProfile("first-session").bindings.new_layer?.validated, true);
assert.equal(
  getKritaShortcutProfile("second-session").bindings.new_layer?.validationFingerprint,
  createKritaShortcutBindingFingerprint(installation, ["INSERT"]),
);

const prepared = prepareKritaShortcuts("second-session", installation);
assert(prepared.ready.includes("new_layer"));
assert(!prepared.needsProbe.includes("new_layer"));

const changed = prepareKritaShortcuts(
  "second-session",
  createKritaInstallationFingerprint({ executablePath: "krita.exe", executableVersion: "5.3", keyboardLayout: "en-US" }),
);
assert(changed.invalidated.includes("new_layer"));
assert(changed.needsProbe.includes("new_layer"));
assert.equal(getKritaShortcutProfile("second-session").bindings.new_layer?.validated, false);

const persisted = JSON.parse(await readFile(join(root, "krita-shortcuts.json"), "utf8")) as { version: number };
assert.equal(persisted.version, 1);
configureKritaShortcutPersistence(undefined);

console.log("Krita shortcut persistence tests passed");
