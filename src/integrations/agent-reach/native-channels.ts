import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

export type ReachPlatform =
  | "web"
  | "rss"
  | "v2ex"
  | "youtube"
  | "github"
  | "bilibili"
  | "reddit"
  | "twitter"
  | "xiaohongshu"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "xueqiu"
  | "exa"
  | "auto";

export interface ChannelResult {
  platform: string;
  backend: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface DoctorChannel {
  id: string;
  name: string;
  status: "ok" | "partial" | "missing";
  backend?: string;
  detail: string;
}

async function findOnPath(command: string): Promise<string | undefined> {
  const exes = process.platform === "win32" ? [`${command}.exe`, command] : [command];
  const searchDirs = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".auvrynt", "bin"),
    join(homedir(), "AppData", "Local", "Programs", "Python", "Python313", "Scripts"),
    join(homedir(), "AppData", "Roaming", "Python", "Scripts"),
    join(homedir(), ".agent-reach-venv", "Scripts"),
    join(homedir(), ".agent-reach-venv", "bin"),
  ];
  for (const dir of searchDirs) {
    for (const exe of exes) {
      const full = join(dir, exe);
      if (existsSync(full)) return full;
    }
  }
  try {
    const whichCmd = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(whichCmd, [command], {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

async function runCli(
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; code: number; executable?: string }> {
  const executable = await findOnPath(command);
  if (!executable) {
    return { stdout: "", stderr: `${command} not found on PATH`, code: 127 };
  }
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0, executable };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(error),
      code: typeof err.code === "number" ? err.code : 1,
      executable,
    };
  }
}

async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Auvrynt-Reach/1.0",
      Accept: "text/plain, text/html, application/json, application/xml, */*",
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchJson(url: string, timeoutMs = 30_000): Promise<unknown> {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

function detectPlatform(url: string): Exclude<ReachPlatform, "auto" | "exa"> {
  const u = url.toLowerCase();
  if (/reddit\.com|redd\.it/.test(u)) return "reddit";
  if (/twitter\.com|x\.com/.test(u)) return "twitter";
  if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
  if (/github\.com/.test(u)) return "github";
  if (/bilibili\.com|b23\.tv/.test(u)) return "bilibili";
  if (/xiaohongshu\.com|xhslink\.com/.test(u)) return "xiaohongshu";
  if (/facebook\.com|fb\.com/.test(u)) return "facebook";
  if (/instagram\.com/.test(u)) return "instagram";
  if (/linkedin\.com/.test(u)) return "linkedin";
  if (/xueqiu\.com/.test(u)) return "xueqiu";
  if (/v2ex\.com/.test(u)) return "v2ex";
  if (/\.(rss|xml|atom)(\?|$)/.test(u) || /\/feed\/?(\?|$)/.test(u) || /\/rss\/?(\?|$)/.test(u)) {
    return "rss";
  }
  return "web";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml: string, limit = 20): Array<{ title?: string; link?: string; summary?: string }> {
  const items: Array<{ title?: string; link?: string; summary?: string }> = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
    const link =
      block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
      block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim();
    const summary =
      block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ||
      block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i)?.[1];
    items.push({
      title: title ? stripHtml(title) : undefined,
      link: link ? stripHtml(link) : undefined,
      summary: summary ? stripHtml(summary).slice(0, 500) : undefined,
    });
  }
  return items;
}

export async function readUrl(url: string, platform: ReachPlatform = "auto"): Promise<ChannelResult> {
  const resolved = platform === "auto" || platform === "exa" ? detectPlatform(url) : platform;

  try {
    switch (resolved) {
      case "web": {
        const text = await fetchText(`https://r.jina.ai/${url}`);
        return { platform: "web", backend: "jina-reader", ok: true, data: { url, content: text.slice(0, 80_000) } };
      }
      case "rss": {
        const xml = await fetchText(url);
        return {
          platform: "rss",
          backend: "native-rss",
          ok: true,
          data: { url, items: parseRssItems(xml) },
        };
      }
      case "v2ex": {
        const match = url.match(/\/t\/(\d+)/);
        if (match) {
          const data = await fetchJson(`https://www.v2ex.com/api/topics/show.json?id=${match[1]}`);
          return { platform: "v2ex", backend: "v2ex-api", ok: true, data };
        }
        const hot = await fetchJson("https://www.v2ex.com/api/topics/hot.json");
        return { platform: "v2ex", backend: "v2ex-api", ok: true, data: hot };
      }
      case "youtube": {
        const ytdlp = await runCli("yt-dlp", ["--dump-json", "--skip-download", url], 90_000);
        if (ytdlp.code !== 0) {
          return {
            platform: "youtube",
            backend: "yt-dlp",
            ok: false,
            error: ytdlp.stderr || "yt-dlp failed",
          };
        }
        try {
          return { platform: "youtube", backend: "yt-dlp", ok: true, data: JSON.parse(ytdlp.stdout) };
        } catch {
          return { platform: "youtube", backend: "yt-dlp", ok: true, data: ytdlp.stdout };
        }
      }
      case "github": {
        const path = url.replace(/^https?:\/\/github\.com\//i, "");
        const gh = await runCli("gh", ["api", `repos/${path.split("/").slice(0, 2).join("/")}`], 30_000);
        if (gh.code === 0) {
          try {
            return { platform: "github", backend: "gh", ok: true, data: JSON.parse(gh.stdout) };
          } catch {
            return { platform: "github", backend: "gh", ok: true, data: gh.stdout };
          }
        }
        const text = await fetchText(`https://r.jina.ai/${url}`);
        return { platform: "github", backend: "jina-reader", ok: true, data: { url, content: text.slice(0, 80_000) } };
      }
      case "bilibili": {
        const bv = url.match(/BV[\w]+/i)?.[0];
        if (bv) {
          const data = await fetchJson(
            `https://api.bilibili.com/x/web-interface/view?bvid=${bv}`,
          );
          return { platform: "bilibili", backend: "bilibili-api", ok: true, data };
        }
        const text = await fetchText(`https://r.jina.ai/${url}`);
        return { platform: "bilibili", backend: "jina-reader", ok: true, data: { url, content: text.slice(0, 80_000) } };
      }
      case "reddit": {
        const opencli = await runCli("opencli", ["reddit", "read", url, "-f", "yaml"], 60_000);
        if (opencli.code === 0) {
          return { platform: "reddit", backend: "opencli", ok: true, data: opencli.stdout };
        }
        const rdt = await runCli("rdt", ["read", url], 60_000);
        if (rdt.code === 0) {
          return { platform: "reddit", backend: "rdt-cli", ok: true, data: rdt.stdout };
        }
        return {
          platform: "reddit",
          backend: "none",
          ok: false,
          error:
            "Reddit requires login. Install OpenCLI (desktop + Chrome extension) or rdt-cli, then log in.",
        };
      }
      case "twitter": {
        const twitter = await runCli("twitter", ["read", url], 60_000);
        if (twitter.code === 0) {
          return { platform: "twitter", backend: "twitter-cli", ok: true, data: twitter.stdout };
        }
        const opencli = await runCli("opencli", ["twitter", "read", url, "-f", "yaml"], 60_000);
        if (opencli.code === 0) {
          return { platform: "twitter", backend: "opencli", ok: true, data: opencli.stdout };
        }
        return {
          platform: "twitter",
          backend: "none",
          ok: false,
          error: "Twitter needs twitter-cli cookies (TWITTER_AUTH_TOKEN/TWITTER_CT0) or OpenCLI session.",
        };
      }
      case "xiaohongshu":
      case "facebook":
      case "instagram": {
        const opencli = await runCli("opencli", [resolved, "read", url, "-f", "yaml"], 60_000);
        if (opencli.code === 0) {
          return { platform: resolved, backend: "opencli", ok: true, data: opencli.stdout };
        }
        return {
          platform: resolved,
          backend: "none",
          ok: false,
          error: `${resolved} requires OpenCLI + Chrome logged-in session.`,
        };
      }
      case "linkedin":
      case "xueqiu": {
        const text = await fetchText(`https://r.jina.ai/${url}`);
        return {
          platform: resolved,
          backend: "jina-reader",
          ok: true,
          data: { url, content: text.slice(0, 80_000), note: "Public page only; authenticated features need extra setup." },
        };
      }
      default:
        return { platform: String(resolved), backend: "none", ok: false, error: `Unsupported platform: ${resolved}` };
    }
  } catch (error) {
    return {
      platform: resolved,
      backend: "error",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchPlatform(
  platform: ReachPlatform,
  query: string,
  limit = 10,
): Promise<ChannelResult> {
  const q = query.trim();
  if (!q) return { platform, backend: "none", ok: false, error: "query is required" };

  try {
    switch (platform) {
      case "web":
      case "exa": {
        const mcp = await runCli(
          "mcporter",
          ["call", "exa.web_search_exa", `query=${q}`, `numResults=${limit}`],
          60_000,
        );
        if (mcp.code === 0) {
          return { platform: "exa", backend: "mcporter-exa", ok: true, data: mcp.stdout };
        }
        const text = await fetchText(`https://r.jina.ai/https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
        return {
          platform: "web",
          backend: "jina-ddg",
          ok: true,
          data: { query: q, content: text.slice(0, 40_000), note: mcp.stderr || "Exa unavailable; used DDG via Jina." },
        };
      }
      case "v2ex": {
        const data = await fetchJson(`https://www.v2ex.com/api/topics/hot.json`);
        const list = Array.isArray(data) ? data : [];
        const filtered = list
          .filter((item) => JSON.stringify(item).toLowerCase().includes(q.toLowerCase()))
          .slice(0, limit);
        return {
          platform: "v2ex",
          backend: "v2ex-api",
          ok: true,
          data: filtered.length > 0 ? filtered : list.slice(0, limit),
        };
      }
      case "bilibili": {
        const data = await fetchJson(
          `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=1`,
        );
        return { platform: "bilibili", backend: "bilibili-api", ok: true, data };
      }
      case "github": {
        const gh = await runCli("gh", ["search", "repos", q, "--limit", String(limit), "--json", "fullName,description,url,stargazersCount"], 30_000);
        if (gh.code === 0) {
          try {
            return { platform: "github", backend: "gh", ok: true, data: JSON.parse(gh.stdout) };
          } catch {
            return { platform: "github", backend: "gh", ok: true, data: gh.stdout };
          }
        }
        return { platform: "github", backend: "gh", ok: false, error: gh.stderr || "gh search failed" };
      }
      case "youtube": {
        const ytdlp = await runCli(
          "yt-dlp",
          [`ytsearch${limit}:${q}`, "--dump-json", "--flat-playlist", "--skip-download"],
          90_000,
        );
        if (ytdlp.code !== 0) {
          return { platform: "youtube", backend: "yt-dlp", ok: false, error: ytdlp.stderr || "yt-dlp search failed" };
        }
        const lines = ytdlp.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });
        return { platform: "youtube", backend: "yt-dlp", ok: true, data: lines };
      }
      case "reddit": {
        const opencli = await runCli("opencli", ["reddit", "search", q, "-f", "yaml"], 60_000);
        if (opencli.code === 0) return { platform: "reddit", backend: "opencli", ok: true, data: opencli.stdout };
        const rdt = await runCli("rdt", ["search", q], 60_000);
        if (rdt.code === 0) return { platform: "reddit", backend: "rdt-cli", ok: true, data: rdt.stdout };
        return {
          platform: "reddit",
          backend: "none",
          ok: false,
          error: "Reddit search needs OpenCLI or rdt-cli with login.",
        };
      }
      case "twitter": {
        const twitter = await runCli("twitter", ["search", q, "-n", String(limit)], 60_000);
        if (twitter.code === 0) return { platform: "twitter", backend: "twitter-cli", ok: true, data: twitter.stdout };
        return {
          platform: "twitter",
          backend: "none",
          ok: false,
          error: "Twitter search needs twitter-cli + TWITTER_AUTH_TOKEN/TWITTER_CT0.",
        };
      }
      case "xiaohongshu":
      case "facebook":
      case "instagram": {
        const opencli = await runCli("opencli", [platform, "search", q, "-f", "yaml"], 60_000);
        if (opencli.code === 0) return { platform, backend: "opencli", ok: true, data: opencli.stdout };
        return {
          platform,
          backend: "none",
          ok: false,
          error: `${platform} search requires OpenCLI + logged-in Chrome session.`,
        };
      }
      default:
        return {
          platform: String(platform),
          backend: "none",
          ok: false,
          error: `Search not implemented for platform: ${platform}`,
        };
    }
  } catch (error) {
    return {
      platform: String(platform),
      backend: "error",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function nativeDoctor(): Promise<DoctorChannel[]> {
  const channels: DoctorChannel[] = [];

  const push = (c: DoctorChannel) => channels.push(c);

  try {
    await fetchText("https://r.jina.ai/https://example.com", 15_000);
    push({ id: "web", name: "Web (Jina Reader)", status: "ok", backend: "jina", detail: "Readable" });
  } catch (e) {
    push({
      id: "web",
      name: "Web (Jina Reader)",
      status: "missing",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await fetchJson("https://www.v2ex.com/api/topics/hot.json", 15_000);
    push({ id: "v2ex", name: "V2EX", status: "ok", backend: "v2ex-api", detail: "Public API reachable" });
  } catch (e) {
    push({ id: "v2ex", name: "V2EX", status: "missing", detail: e instanceof Error ? e.message : String(e) });
  }

  push({ id: "rss", name: "RSS/Atom", status: "ok", backend: "native-rss", detail: "Parser available" });

  const ytdlp = await findOnPath("yt-dlp");
  push(
    ytdlp
      ? { id: "youtube", name: "YouTube", status: "ok", backend: "yt-dlp", detail: ytdlp }
      : { id: "youtube", name: "YouTube", status: "missing", detail: "yt-dlp not installed" },
  );

  const gh = await findOnPath("gh");
  push(
    gh
      ? { id: "github", name: "GitHub", status: "partial", backend: "gh", detail: `${gh} (auth not verified)` }
      : { id: "github", name: "GitHub", status: "missing", detail: "gh CLI not installed" },
  );

  try {
    await fetchJson("https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=test&page=1", 15_000);
    push({ id: "bilibili", name: "Bilibili", status: "ok", backend: "bilibili-api", detail: "Search API reachable" });
  } catch (e) {
    push({ id: "bilibili", name: "Bilibili", status: "missing", detail: e instanceof Error ? e.message : String(e) });
  }

  const mcporter = await findOnPath("mcporter");
  push(
    mcporter
      ? { id: "exa", name: "Exa search", status: "partial", backend: "mcporter", detail: `${mcporter} (remote not probed)` }
      : { id: "exa", name: "Exa search", status: "missing", detail: "mcporter not installed" },
  );

  const opencli = await findOnPath("opencli");
  const rdt = await findOnPath("rdt");
  const twitter = await findOnPath("twitter");

  push(
    opencli || rdt
      ? {
          id: "reddit",
          name: "Reddit",
          status: "partial",
          backend: opencli ? "opencli" : "rdt-cli",
          detail: "CLI present; login required",
        }
      : { id: "reddit", name: "Reddit", status: "missing", detail: "Need OpenCLI or rdt-cli + login" },
  );

  push(
    twitter || opencli
      ? {
          id: "twitter",
          name: "Twitter/X",
          status: "partial",
          backend: twitter ? "twitter-cli" : "opencli",
          detail: "CLI present; cookies/session required",
        }
      : { id: "twitter", name: "Twitter/X", status: "missing", detail: "Need twitter-cli or OpenCLI" },
  );

  for (const id of ["xiaohongshu", "facebook", "instagram"] as const) {
    push(
      opencli
        ? { id, name: id, status: "partial", backend: "opencli", detail: "OpenCLI present; Chrome session required" }
        : { id, name: id, status: "missing", detail: "OpenCLI required" },
    );
  }

  return channels;
}

export { findOnPath, runCli };
