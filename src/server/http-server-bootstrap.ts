import express, { type Express } from "express";
import { createFixedWindowRateLimiter } from "../infrastructure/http-rate-limit.js";
import { brandAssetDirectory, setAssetHeaders, uiBuildDirectory } from "./ui-assets.js";

export function registerOAuthRateLimits(app: Express): void {
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

export function registerOAuthTokenBasicAuth(app: Express): void {
  app.use("/token", express.urlencoded({ extended: false }));
  app.use("/token", (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
      try {
        const credentials = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
        const colonIndex = credentials.indexOf(":");
        if (colonIndex !== -1) {
          const rawId = credentials.slice(0, colonIndex);
          const rawSecret = credentials.slice(colonIndex + 1);
          let clientId: string;
          let clientSecret: string;
          try {
            clientId = decodeURIComponent(rawId);
            clientSecret = decodeURIComponent(rawSecret);
          } catch {
            clientId = rawId;
            clientSecret = rawSecret;
          }
          if (!req.body || typeof req.body !== "object") {
            req.body = {};
          }
          if (!req.body.client_id) {
            req.body.client_id = clientId;
          }
          if (!req.body.client_secret && clientSecret) {
            req.body.client_secret = clientSecret;
          }
        }
      } catch {
        // Let downstream token handler handle invalid auth
      }
    }
    next();
  });
}

export function registerStaticAssets(app: Express): void {
  app.options("/mcp-app-assets/{*asset}", (_req, res) => {
    setAssetHeaders(res);
    res.sendStatus(204);
  });
  app.use("/brand-assets", express.static(brandAssetDirectory(), {
    maxAge: "1d",
    fallthrough: false,
    setHeaders: setAssetHeaders,
  }));
  app.use("/mcp-app-assets", express.static(uiBuildDirectory(), {
    immutable: true,
    maxAge: "1y",
    fallthrough: false,
    setHeaders: setAssetHeaders,
  }));
}
