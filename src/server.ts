import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import express from "express";
import type { Request, Response } from "express";
import { loadConfig, oauthScopesForIntegrations, type ServerConfig } from "./config.js";
import {
  isLoopbackRequest,
  logEvent,
  requestPath,
  sessionIdPrefix,
} from "./logger.js";
import { SingleUserOAuthProvider } from "./oauth-provider.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { createArtifactRegistry } from "./artifact-registry.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { ProcessManager } from "./processes.js";
import { recordConnectedClient } from "./connection-registry.js";
import {
  SessionRegistry,
  type SessionReservation,
} from "./session-registry.js";
import { RoomRegistry } from "./room-registry.js";
import { createShutdownCoordinator } from "./shutdown.js";
import { hardenHttpServer } from "./http-server-hardening.js";
import { createFixedWindowRateLimiter } from "./http-rate-limit.js";
import { BoundedMcpEventStore } from "./mcp-event-store.js";
import { runWithContext } from "./request-context.js";
import { getQueueDiagnostics } from "./integration-queue.js";
import {
  hasRequiredScopes,
  requiredScopesForToolCall,
  requiredScopesForToolName,
  toolIntegrationEnabled,
} from "./server/mcp-policy.js";
export {
  requiredScopesForToolCall,
  requiredScopesForToolName,
  toolIntegrationEnabled,
} from "./server/mcp-policy.js";
import { attachSseHeartbeat } from "./sse-heartbeat.js";
import { SerenaManager } from "./serena-manager.js";
import { createMcpServer } from "./server/mcp-server-factory.js";
import { applyIntegrationProfileUpdate } from "./server/integration-profile-update.js";
import { syncMcpToolAvailability } from "./server/mcp-tool-registrar.js";
import { openAiLogicalSessionId } from "./server/openai-session-hint.js";
import { createWorkspaceChangeTracker } from "./server/workspace-analytics.js";
import {
  isMainModule,
  mcpClientName,
  requestLogFields,
  sendJsonRpcError,
} from "./server/http-helpers.js";
import {
  brandAssetDirectory,
  setAssetHeaders,
  uiBuildDirectory,
  workspaceAppAssetInfo,
  workspaceAppHtml,
} from "./server/ui-assets.js";
import { registerDashboardRoutes } from "./server/dashboard-routes.js";

type Transport = StreamableHTTPServerTransport;

let eventLoopDelay = 0;
let expectedEventLoopProbeAt = Date.now() + 1_000;
const eventLoopProbe = setInterval(() => {
  const now = Date.now();
  eventLoopDelay = Math.max(0, now - expectedEventLoopProbeAt);
  expectedEventLoopProbeAt = now + 1_000;
}, 1_000);
eventLoopProbe.unref();
export interface RunningServer {
  app: ReturnType<typeof createMcpExpressApp>;
  config: ServerConfig;
  updateIntegrations(integrations: ServerConfig["integrations"], options?: { serenaExecutable?: string }): Promise<{ updated: boolean; activeRequests: number; activeToolCalls: number; closedSessions: number }>;
  refreshToolAvailability(): void;
  updateSessionLimit(maxSessions: number): void;
  updateSessionIdleTimeout(timeoutMs: number): void;
  updateWorkspaceRoots(roots: string[]): { updated: boolean; activeToolCalls: number; closedWorkspaces: number };
  close(): Promise<void>;
}
export function createServer(config = loadConfig()): RunningServer {
  const allowedHosts = config.allowedHosts.includes("*") ? ["*"] : Array.from(new Set([config.host, ...config.allowedHosts]));
  const app = createMcpExpressApp({ host: config.host, allowedHosts });
  const sessionRegistry = new SessionRegistry(config, { maxSessions: config.maxSessions, maxSessionsPerOwner: config.maxSessionsPerClient, sessionIdleTimeoutMs: config.sessionIdleTimeoutMs });
  const mcpUrl = new URL("/mcp", config.publicBaseUrl);
  const resourceServerUrl = resourceUrlFromServerUrl(mcpUrl);
  const oauthProvider = new SingleUserOAuthProvider(
    { ...config.oauth, logging: config.logging },
    mcpUrl,
    join(config.stateDir, "oauth-state.json"),
  );
  // A server restart can enable an integration without a live profile update.
  // Extend existing grants to match the enabled local integrations so clients
  // do not keep a stale, narrower tool list after reconnecting.
  oauthProvider.grantScopesToExistingTokens(oauthScopesForIntegrations(config.integrations));
  const bearerAuth = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
    resourceMetadataUrl:
      getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });
  const workspaceStore = createWorkspaceStore(config.stateDir);
  const workspaceDb = workspaceStore.getDatabase?.();
  const roomRegistry = new RoomRegistry(workspaceDb);
  if (workspaceDb) createArtifactRegistry(workspaceDb.db);
  const workspaces = new WorkspaceRegistry(config, workspaceStore);
  const processManager = new ProcessManager(workspaces);
  const reviewCheckpoints = createReviewCheckpointManager(), workspaceChanges = createWorkspaceChangeTracker();
  const serenaManager = new SerenaManager({
    enabled: config.serena.enabled,
    executable: config.serena.executable,
    backend: config.serena.backend,
    context: config.serena.context,
    startupTimeoutMs: config.serena.startupTimeoutMs,
    requestTimeoutMs: config.serena.requestTimeoutMs,
    idleTimeoutMinutes: config.serena.idleTimeoutMinutes,
    maxInstances: config.serena.maxInstances,
  });
  // Populate the tool inventory at startup so the dashboard tool settings view
  // shows every registered tool before any MCP client connects. Without this,
  // the inventory stays empty until a session initializes (registerAppTool is
  // otherwise only invoked from createMcpServer, which runs per session).
  // The throwaway server is never connected; only its registrations matter.
  // Sessions created later register the same names idempotently.
  void createMcpServer(
    config,
    workspaces,
    reviewCheckpoints,
    serenaManager,
    processManager,
    roomRegistry,
    sessionRegistry,
    workspaceChanges,
  );
  let activeMcpRequests = 0;
  let activeToolCalls = 0;
  let lastMcpActivityAt: number | undefined;
  let acceptingRequests = true;
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.on("finish", () => {
      const path = requestPath(req);
      if (!config.logging.requests) return;
      if (path.startsWith("/dashboard")) return;
      if (!config.logging.assets && path.startsWith("/mcp-app-assets")) return;
      logEvent(config.logging, "info", "http_request", {
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        ...requestLogFields(req),
      });
    });
    next();
  });
  app.use((_req, res, next) => {
    if (!acceptingRequests) {
      res.status(503).json({ error: "Auvrynt is shutting down" });
      return;
    }
    next();
  });
  registerOAuthRateLimits(app);
  app.use("/.well-known/openid-configuration", (req, _res, next) => { req.url = "/.well-known/oauth-authorization-server"; next(); });
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(config.publicBaseUrl),
      baseUrl: new URL(config.publicBaseUrl),
      resourceServerUrl,
      scopesSupported: config.oauth.scopes,
      resourceName: "Auvrynt",
      // Auvrynt applies its own rate limit above; disable SDK's duplicate limiter.
      clientRegistrationOptions: { rateLimit: false },
    }),
  );
  registerStaticAssets(app);

  const dashboardSnapshot = () => ({
    ready: acceptingRequests, sessions: sessionRegistry.connectedCount(), activeToolCalls,
    lastMcpActivityAt, runningProcesses: processManager.runningCount(),
    workspaceChanges: workspaceChanges.snapshot(),
  });

  registerDashboardRoutes({
    app,
    config,
    snapshot: dashboardSnapshot,
    nonce: () => randomBytes(18).toString("base64url"),
  });

  app.get("/tool-card-preview", (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const previewUrl = new URL(req.originalUrl, `http://${req.headers.host ?? "127.0.0.1"}`);
    previewUrl.searchParams.set("preview", "1");
    const localAssetBaseUrl = `${previewUrl.origin}/mcp-app-assets`;
    res.type("html").send(
      workspaceAppHtml(config, localAssetBaseUrl).replace(
        "</head>",
        `<base href="${previewUrl.pathname}${previewUrl.search}" /></head>`,
      ),
    );
  });

  app.get("/tool-card-source", (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      preview: "/tool-card-preview?preview=1&tool=read_file&path=KNOWN_ISSUES.md&lines=42",
      html: workspaceAppHtml(config),
      assets: workspaceAppAssetInfo(config),
    });
  });

  app.get("/healthz", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRequest(req)) {
      res.json({ ok: true });
      return;
    }
    res.json({
      ok: true,
      name: "auvrynt",
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/readyz", (req, res) => {
    const sessionCapacityReached = sessionRegistry.isAtCapacity();
    const ready = acceptingRequests;
    res.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRequest(req)) {
      res.status(ready ? 200 : 503).json({ ready });
      return;
    }
    res.status(ready ? 200 : 503).json({
      ready,
      sessions: sessionRegistry.activeCount(),
      sessionsByState: ready ? sessionRegistry.countByState() : undefined,
      sessionCapacityReached,
      activeMcpRequests,
      activeToolCalls,
      eventLoopDelay,
      runningProcesses: processManager.runningCount(),
      memory: process.memoryUsage(),
      integrationQueues: getQueueDiagnostics(),
    });
  });

  app.all("/mcp", async (req, res) => {
    attachSseHeartbeat(res);
    const requestId = res.locals.requestId as string | undefined;
    const sessionId = req.header("mcp-session-id");
    const initializeRequest =
      req.method === "POST" && isInitializeRequest(req.body);
    activeMcpRequests++;
    let requestReleased = false;
    const releaseRequest = () => {
      if (requestReleased) return;
      requestReleased = true;
      activeMcpRequests--;
    };
    res.once("finish", releaseRequest);
    res.once("close", releaseRequest);

    await new Promise<void>((resolve, reject) => {
      bearerAuth(req, res, (error?: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (res.headersSent) return;

    if (
      !req.auth?.resource
      || !checkResourceAllowed({
        requestedResource: req.auth.resource,
        configuredResource: resourceServerUrl,
      })
    ) {
      logEvent(config.logging, "warn", "auth_denied", {
        requestId,
        method: req.method,
        path: requestPath(req),
        reason: "invalid_oauth_resource",
        ...requestLogFields(req),
      });
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }

    lastMcpActivityAt = Date.now();
    const authScopes = req.auth.scopes ?? [];
    const toolCalls = Array.isArray(req.body) ? req.body : [req.body];
    for (const message of toolCalls) {
      if (!message || typeof message !== "object") continue;
      const rpc = message as {
        method?: unknown;
        params?: { name?: unknown; arguments?: unknown };
      };
      if (rpc.method !== "tools/call" || typeof rpc.params?.name !== "string") {
        continue;
      }
      const toolName = rpc.params.name;
      const requiredScopes = requiredScopesForToolCall(
        toolName,
        rpc.params.arguments,
      );
      if (!toolIntegrationEnabled(config, toolName)) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          tool: toolName,
          reason: "integration_disabled",
        });
        sendJsonRpcError(
          res,
          403,
          -32003,
          "Forbidden: integration disabled",
        );
        return;
      }
      if (!hasRequiredScopes(authScopes, requiredScopes)) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          tool: toolName,
          reason: "missing_scope",
          requiredScopes,
        });
        sendJsonRpcError(
          res,
          403,
          -32003,
          "Forbidden: insufficient OAuth scope",
        );
        return;
      }
    }

    if (sessionId) {
      const record = sessionRegistry.get(sessionId);
      if (record && record.ownerClientId !== req.auth.clientId) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          reason: "mcp_session_owner_mismatch",
          sessionIdPrefix: sessionIdPrefix(sessionId),
        });
        sendJsonRpcError(
          res,
          403,
          -32003,
          "Forbidden: MCP session belongs to a different OAuth client",
        );
        return;
      }
    }

    const containsToolCall = toolCalls.some((message) => {
      if (!message || typeof message !== "object") return false;
      return (message as { method?: unknown }).method === "tools/call";
    });
    const logicalSessionId = openAiLogicalSessionId(toolCalls);
    if (containsToolCall) activeToolCalls++;

    try {
      recordConnectedClient(config.stateDir, {
        clientName: mcpClientName(req),
        userAgent: req.header("user-agent") ?? undefined,
      });
    } catch (error) {
      logEvent(config.logging, "warn", "connection_registry_write_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logEvent(config.logging, "debug", "mcp_request", {
      requestId,
      method: req.method,
      sessionIdPresent: Boolean(sessionId),
      sessionIdPrefix: sessionIdPrefix(sessionId),
      isInitialize: initializeRequest,
    });

    let reservation: SessionReservation | undefined;
    let initializingServer: McpServer | undefined;
    let requestSessionId: string | undefined;
    let requestBegan = false;
    let initializationCommitted = false;

    try {
      let transport: Transport | undefined;
      if (sessionId) {
        const record = sessionRegistry.get(sessionId);
        if (!record) {
          sendJsonRpcError(res, 404, -32000, "Unknown MCP session");
          return;
        }
        if (record.state === "expired") {
          sendJsonRpcError(res, 404, -32000, "MCP session has expired");
          return;
        }
        if (record.state === "closing") {
          sendJsonRpcError(res, 503, -32000, "MCP session is closing");
          return;
        }
        if (req.method === "DELETE" && !sessionRegistry.canTerminate(sessionId)) {
          sendJsonRpcError(
            res,
            409,
            -32000,
            "MCP session has active tool calls; retry termination after they finish",
          );
          return;
        }
        if (!sessionRegistry.beginRequest(sessionId, containsToolCall)) {
          sendJsonRpcError(res, 503, -32000, "MCP session is unavailable");
          return;
        }
        if (logicalSessionId) {
          sessionRegistry.bindLogicalSession(sessionId, logicalSessionId);
        }
        requestSessionId = sessionId;
        requestBegan = true;
        transport = record.transport;
      } else if (initializeRequest) {
        reservation = sessionRegistry.reserve(req.auth.clientId);
        if (!reservation) {
          logEvent(config.logging, "warn", "mcp_session_capacity_reached", {
            requestId,
            clientId: req.auth.clientId,
            sessions: sessionRegistry.activeCount(),
            occupiedSessions: sessionRegistry.occupiedCount(),
            maxSessions: config.maxSessions,
          });
          sendJsonRpcError(
            res,
            503,
            -32000,
            `MCP session capacity reached; maximum ${config.maxSessions} concurrent sessions`,
          );
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore: new BoundedMcpEventStore(),
          retryInterval: 1_500,
          onsessioninitialized: async (newSessionId) => {
            try {
              sessionRegistry.create(
                reservation!,
                transport!,
                initializingServer!,
              );
              reservation = undefined;
              sessionRegistry.transition(newSessionId, "active");
              if (logicalSessionId) {
                sessionRegistry.bindLogicalSession(newSessionId, logicalSessionId);
              }
              if (!sessionRegistry.beginRequest(newSessionId, false)) {
                throw new Error("Initialized MCP session could not acquire its request lease");
              }
              initializationCommitted = true;
              requestSessionId = newSessionId;
              requestBegan = true;
              logEvent(config.logging, "info", "mcp_session_created", {
                requestId,
                sessionIdPrefix: sessionIdPrefix(newSessionId),
                ...requestLogFields(req),
              });
            } catch (error) {
              if (sessionRegistry.get(newSessionId)) {
                await sessionRegistry.closeSession(newSessionId, "initialization_failed");
              }
              logEvent(config.logging, "error", "mcp_session_init_failed", {
                requestId,
                error: error instanceof Error ? error.message : String(error),
                sessionIdPrefix: sessionIdPrefix(newSessionId),
              });
              throw error;
            }
          },
          onsessionclosed: (closedSessionId) => {
            sessionRegistry.markClosing(closedSessionId, "client_delete");
          },
        });
        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            sessionRegistry.handleTransportClosed(closedSessionId, "transport_closed");
          }
        };

        try {
          initializingServer = createMcpServer(
            config,
            workspaces,
            reviewCheckpoints,
            serenaManager,
            processManager,
            roomRegistry,
            sessionRegistry,
            workspaceChanges,
          );
        } catch (error) {
          logEvent(config.logging, "error", "mcp_server_create_failed", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          sendJsonRpcError(res, 500, -32603, "Failed to create MCP server");
          return;
        }
        try {
          await initializingServer.connect(transport);
        } catch (error) {
          logEvent(config.logging, "error", "mcp_server_connect_failed", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          sendJsonRpcError(
            res,
            500,
            -32603,
            "Failed to initialize MCP server",
          );
          return;
        }
      } else {
        sendJsonRpcError(res, 400, -32000, "No valid MCP session");
        return;
      }

      if (sessionId) {
        await runWithContext(
          {
            sessionId,
            ownerClientId: req.auth!.clientId,
            authScopes,
          },
          () => transport!.handleRequest(req, res, req.body),
        );
      } else {
        await transport!.handleRequest(req, res, req.body);
        if (initializationCommitted && res.statusCode >= 400 && requestSessionId) {
          await sessionRegistry.closeSession(requestSessionId, "initialization_failed");
        }
      }
    } catch (error) {
      logEvent(config.logging, "error", "mcp_request_error", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    } finally {
      if (requestBegan && requestSessionId) {
        sessionRegistry.endRequest(requestSessionId, containsToolCall);
      }
      if (reservation) {
        sessionRegistry.release(reservation);
        await initializingServer?.close().catch(() => undefined);
      }
      if (containsToolCall) activeToolCalls--;
    }
  });

  app.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      next: (error?: unknown) => void,
    ) => {
      logEvent(config.logging, "error", "http_unhandled_error", {
        requestId: res.locals.requestId,
        method: req.method,
        path: requestPath(req),
        error: error instanceof Error ? error.message : String(error),
      });
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );

  const shutdownCoordinator = createShutdownCoordinator(
    config,
    sessionRegistry,
    processManager,
    serenaManager,
    workspaceStore,
  );
  let closed = false;
  return {
    app,
    config,
    updateSessionLimit(maxSessions) {
      sessionRegistry.updateLimits(maxSessions);
      config.maxSessions = maxSessions;
      config.maxSessionsPerClient = maxSessions;
    },
    updateSessionIdleTimeout(timeoutMs) { sessionRegistry.updateSessionIdleTimeout(timeoutMs); config.sessionIdleTimeoutMs = timeoutMs; },
    updateWorkspaceRoots(roots) {
      if (activeToolCalls > 0) return { updated: false, activeToolCalls, closedWorkspaces: 0 };
      return { updated: true, activeToolCalls: 0, closedWorkspaces: workspaces.replaceAllowedRoots(roots).length };
    },
    async updateIntegrations(integrations, options) {
      if (activeToolCalls > 0) {
        return {
          updated: false,
          activeRequests: activeMcpRequests,
          activeToolCalls,
          closedSessions: 0,
        };
      }

      await applyIntegrationProfileUpdate({
        config,
        integrations,
        serenaExecutable: options?.serenaExecutable,
        oauthProvider,
        serenaManager,
        mcpServers: sessionRegistry.allRecords().map((record) => record.mcpServer),
      });
      return {
        updated: true,
        activeRequests: activeMcpRequests,
        activeToolCalls: 0,
        closedSessions: 0,
      };
    },
    refreshToolAvailability() {
      for (const record of sessionRegistry.allRecords()) {
        syncMcpToolAvailability(record.mcpServer, config);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      acceptingRequests = false;
      await shutdownCoordinator.shutdown();
    },
  };
}
function registerOAuthRateLimits(
  app: ReturnType<typeof createMcpExpressApp>,
): void {
  app.post("/authorize", createFixedWindowRateLimiter({
    windowMs: 5 * 60_000,
    maxRequests: 12,
    message: "Too many authorization attempts. Try again later.",
  }));
  app.post("/register", createFixedWindowRateLimiter({
    windowMs: 60 * 60_000,
    maxRequests: 600,
    message: "Too many OAuth client registrations. Try again later.",
  }));
  app.post("/token", createFixedWindowRateLimiter({
    windowMs: 5 * 60_000,
    maxRequests: 600,
    message: "Too many token requests. Try again later.",
  }));
  app.post("/revoke", createFixedWindowRateLimiter({
    windowMs: 5 * 60_000,
    maxRequests: 600,
    message: "Too many token revocation requests. Try again later.",
  }));
}
function registerStaticAssets(
  app: ReturnType<typeof createMcpExpressApp>,
): void {
  app.options("/mcp-app-assets/{*asset}", (_req, res) => {
    setAssetHeaders(res);
    res.sendStatus(204);
  });
  app.use(
    "/brand-assets",
    express.static(brandAssetDirectory(), {
      maxAge: "1d",
      fallthrough: false,
      setHeaders: setAssetHeaders,
    }),
  );
  app.use(
    "/mcp-app-assets",
    express.static(uiBuildDirectory(), {
      immutable: true,
      maxAge: "1y",
      fallthrough: false,
      setHeaders: setAssetHeaders,
    }),
  );
}

if (await isMainModule(import.meta.url)) {
  const { app, config } = createServer();
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`auvrynt listening on http://${config.host}:${config.port}/mcp`);
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log("auth: oauth owner-token flow required");
    console.log(`logging: ${config.logging.level} ${config.logging.format}`);
    console.log(
      `request logging: ${config.logging.requests ? "enabled" : "disabled"}`,
    );
    console.log(
      `asset logging: ${config.logging.assets ? "enabled" : "disabled"}`,
    );
    console.log("trust proxy: loopback only");
  });
  hardenHttpServer(httpServer);
}
