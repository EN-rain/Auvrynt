import assert from "node:assert/strict";
import type { ServerConfig, WidgetMode } from "../config.js";
import { toolWidgetDescriptorMeta, WORKSPACE_APP_URI } from "./tool-registration-shared.js";

function config(widgets: WidgetMode): ServerConfig {
  return { widgets } as ServerConfig;
}

{
  const meta = toolWidgetDescriptorMeta(config("compact"), "read")._meta;
  assert.equal(meta["openai/toolInvocation/invoking"], "Reading…");
  assert.equal(meta["openai/toolInvocation/invoked"], "Read complete");
  assert.equal("ui" in meta, false);
  assert.equal("openai/outputTemplate" in meta, false);
}

{
  const meta = toolWidgetDescriptorMeta(config("changes"), "read")._meta;
  assert.equal(meta["openai/toolInvocation/invoking"], "Reading…");
  assert.equal("ui" in meta, false);
  assert.equal("openai/outputTemplate" in meta, false);
}

{
  const meta = toolWidgetDescriptorMeta(config("changes"), "show_changes")._meta;
  assert.deepEqual(meta.ui, {
    resourceUri: WORKSPACE_APP_URI,
    visibility: ["model", "app"],
  });
  assert.equal(meta["openai/outputTemplate"], WORKSPACE_APP_URI);
}

{
  const meta = toolWidgetDescriptorMeta(config("full"), "read")._meta;
  assert.equal(meta["openai/outputTemplate"], WORKSPACE_APP_URI);
  assert.ok(meta.ui);
}

assert.deepEqual(toolWidgetDescriptorMeta(config("off"), "read"), { _meta: {} });

console.log("Tool registration shared metadata tests passed!");
