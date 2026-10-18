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
