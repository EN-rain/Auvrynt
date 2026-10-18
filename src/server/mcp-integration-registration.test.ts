import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { integrationRegistrationEnabled } from "./mcp-server-factory.js";

const config = loadConfig({
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  PORT: "1",
});

config.integrations.serena = false;
config.serena.enabled = false;

assert.equal(integrationRegistrationEnabled(config, "serena"), false);
assert.equal(integrationRegistrationEnabled(config, "agentReach"), true);

assert.equal(integrationRegistrationEnabled(config, "agentReach"), true);

config.integrations.serena = true;
config.serena.enabled = true;
assert.equal(integrationRegistrationEnabled(config, "serena"), true);

config.serena.enabled = false;
assert.equal(integrationRegistrationEnabled(config, "serena"), false);

config.serena.enabled = true;
config.oauth.scopes = config.oauth.scopes.filter((scope) => scope !== "auvrynt:serena");
assert.equal(integrationRegistrationEnabled(config, "serena"), false);
assert.equal(integrationRegistrationEnabled(config, "agentReach"), true);

console.log("MCP integration registration matrix tests passed!");
