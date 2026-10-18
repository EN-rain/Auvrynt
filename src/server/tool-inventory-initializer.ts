import { createMcpServer } from "./mcp-server-factory.js";

export function initializeToolInventory(...args: Parameters<typeof createMcpServer>): void {
  // Populate the tool inventory at startup so the dashboard tool settings view
  // shows every registered tool before any MCP client connects. Without this,
  // the inventory stays empty until a session initializes (registerAppTool is
  // otherwise only invoked from createMcpServer, which runs per session).
  // The throwaway server is never connected; only its registrations matter.
  // Sessions created later register the same names idempotently.
  void createMcpServer(...args);
}
