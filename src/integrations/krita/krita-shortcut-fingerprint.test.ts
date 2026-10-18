import assert from "node:assert/strict";
import {
  createKritaInstallationFingerprint,
  createKritaShortcutBindingFingerprint,
} from "./krita-shortcut-fingerprint.js";

const installation = createKritaInstallationFingerprint({
  executablePath: "C:/Program Files/Krita/krita.exe",
  executableVersion: "5.2.6",
  keyboardLayout: "en-US",
});
assert.match(installation, /^sha256:[0-9a-f]{64}$/);
assert.equal(
  installation,
  createKritaInstallationFingerprint({
    executablePath: "C:/Program Files/Krita/krita.exe",
    executableVersion: "5.2.6",
    keyboardLayout: "en-US",
  }),
);
assert.notEqual(
  installation,
  createKritaInstallationFingerprint({
    executablePath: "C:/Program Files/Krita/krita.exe",
    executableVersion: "5.2.7",
    keyboardLayout: "en-US",
  }),
);
assert.notEqual(
  createKritaShortcutBindingFingerprint(installation, ["CTRL", "S"]),
  createKritaShortcutBindingFingerprint(installation, ["CTRL", "SHIFT", "S"]),
);

console.log("Krita shortcut fingerprint tests passed");
