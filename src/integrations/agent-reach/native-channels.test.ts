import assert from "node:assert/strict";
import {
  cliEnvironment,
  detectPlatform,
  fetchText,
  parseRssItems,
  readUrl,
  searchPlatform,
  type CliRunner,
  type SafeFetchOptions,
} from "./native-channels.js";
import type { DnsResolver } from "../../infrastructure/network-security.js";

const PUBLIC_IP = "93.184.216.34";
const publicResolver: DnsResolver = async () => [{ address: PUBLIC_IP, family: 4 }];

function options(fetchImpl: typeof fetch, overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions {
  return {
    fetchImpl,
    resolver: publicResolver,
    timeoutMs: 1_000,
    maxRedirects: 3,
    maxResponseBytes: 1_024,
    ...overrides,
  };
}

assert.equal(detectPlatform("https://example.com/feed.xml"), "rss");
assert.equal(detectPlatform("https://github.com/openai/openai-node"), "github");
assert.equal(detectPlatform("https://example.com/article"), "web");

const rss = parseRssItems(`
  <rss><channel>
    <item><title>One</title><link>https://example.com/1</link><description>Hello <b>world</b></description></item>
    <item><title>Two</title><link>https://example.com/2</link><description>Second</description></item>
  </channel></rss>
`);
assert.equal(rss.length, 2);
assert.deepEqual(rss[0], {
  title: "One",
  link: "https://example.com/1",
  summary: "Hello world",
});

let privateFetchCalled = false;
await assert.rejects(
  () => fetchText("http://169.254.169.254/latest/meta-data/", options(async () => {
    privateFetchCalled = true;
    return new Response("should not be reached");
  })),
  /Blocked SSRF/i,
);
assert.equal(privateFetchCalled, false, "private literal targets must be rejected before fetch");

let redirectFetchCount = 0;
await assert.rejects(
  () => fetchText("https://public.example/start", options(async () => {
    redirectFetchCount += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: "http://10.0.0.7/internal" },
    });
  })),
  /Blocked SSRF/i,
);
assert.equal(redirectFetchCount, 1, "private redirect target must be rejected before the redirected fetch");

await assert.rejects(
  () => fetchText("https://public.example/large", options(async () => new Response("x".repeat(2_048)), {
    maxResponseBytes: 512,
  })),
  /response size limit/i,
);

let redirects = 0;
await assert.rejects(
  () => fetchText("https://public.example/loop", options(async () => {
    redirects += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: `https://public.example/loop-${redirects}` },
    });
  }, { maxRedirects: 2 })),
  /too many redirects/i,
);
assert.equal(redirects, 3);

const timeoutFetch: typeof fetch = async (_input, init) => {
  const signal = init?.signal;
  return await new Promise<Response>((resolve, reject) => {
    if (!signal) {
      reject(new Error("missing abort signal"));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const keepAlive = setTimeout(() => resolve(new Response("late")), 1_000);
    signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    }, { once: true });
  });
};
await assert.rejects(
  () => fetchText("https://public.example/slow", options(timeoutFetch, { timeoutMs: 5 })),
  /timeout|abort/i,
);

const normal = await fetchText(
  "https://public.example/ok",
  options(async () => new Response("hello")),
);
assert.equal(normal, "hello");

const blockedRss = await readUrl("http://127.0.0.1/private-feed.xml", "rss");
assert.equal(blockedRss.ok, false);
assert.match(blockedRss.error ?? "", /loopback|Blocked SSRF/i);

const isolatedEnv = cliEnvironment({
  PATH: "C:\\safe-bin",
  HOME: "C:\\Users\\test",
  GH_TOKEN: "github-secret",
  GITHUB_TOKEN: "github-secret-2",
  TWITTER_AUTH_TOKEN: "twitter-secret",
  TWITTER_CT0: "twitter-csrf",
  OPENAI_API_KEY: "unrelated-secret",
});
assert.equal(isolatedEnv.PATH, "C:\\safe-bin");
assert.equal(isolatedEnv.HOME, "C:\\Users\\test");
assert.equal(isolatedEnv.GH_TOKEN, undefined);
assert.equal(isolatedEnv.GITHUB_TOKEN, undefined);
assert.equal(isolatedEnv.TWITTER_AUTH_TOKEN, undefined);
assert.equal(isolatedEnv.TWITTER_CT0, undefined);
assert.equal(isolatedEnv.OPENAI_API_KEY, undefined);

let cliCalls = 0;
const forbiddenCli: CliRunner = async () => {
  cliCalls += 1;
  throw new Error("CLI should not run");
};
const githubHttpFallback = await readUrl(
  "https://github.com/openai/openai-node",
  "github",
  {
    allowCli: false,
    cliRunner: forbiddenCli,
    fetchOptions: options(async () => new Response("github via HTTP")),
  },
);
assert.equal(githubHttpFallback.ok, true);
assert.equal(githubHttpFallback.backend, "jina-reader");
assert.equal(cliCalls, 0, "read-only GitHub reads must not trigger gh");

const githubCli = await readUrl(
  "https://github.com/openai/openai-node",
  "github",
  {
    allowCli: true,
    cliRunner: async (command) => {
      cliCalls += 1;
      assert.equal(command, "gh");
      return { stdout: '{"name":"openai-node"}', stderr: "", code: 0 };
    },
    fetchOptions: options(async () => {
      throw new Error("HTTP fallback should not run when gh succeeds");
    }),
  },
);
assert.equal(githubCli.ok, true);
assert.equal(githubCli.backend, "gh");
assert.deepEqual(githubCli.data, { name: "openai-node" });
assert.equal(cliCalls, 1, "process-authorized GitHub read should use gh when available");

const malformedGithub = await readUrl(
  "https://github.com/openai/openai-node",
  "github",
  {
    allowCli: true,
    cliRunner: async () => ({ stdout: "{not-json", stderr: "", code: 0 }),
    fetchOptions: options(async () => {
      throw new Error("successful gh should not fall back");
    }),
  },
);
assert.equal(malformedGithub.ok, true);
assert.equal(malformedGithub.backend, "gh");
assert.equal(malformedGithub.data, "{not-json", "malformed optional CLI output must remain bounded opaque data rather than crash parsing");

const missingYoutube = await readUrl(
  "https://youtube.com/watch?v=abc",
  "youtube",
  {
    allowCli: true,
    cliRunner: async () => ({ stdout: "", stderr: "yt-dlp not found on PATH", code: 127 }),
    fetchOptions: options(async () => {
      throw new Error("YouTube CLI-only path should not fetch");
    }),
  },
);
assert.equal(missingYoutube.ok, false);
assert.match(missingYoutube.error ?? "", /not found/i);

const redditSequence: string[] = [];
const redditFallback = await readUrl(
  "https://reddit.com/r/typescript/comments/example",
  "reddit",
  {
    allowCli: true,
    cliRunner: async (command) => {
      redditSequence.push(command);
      if (command === "opencli") return { stdout: "", stderr: "not logged in", code: 1 };
      return { stdout: "reddit result", stderr: "", code: 0 };
    },
    fetchOptions: options(async () => {
      throw new Error("Reddit CLI fallback should not fetch");
    }),
  },
);
assert.deepEqual(redditSequence, ["opencli", "rdt"]);
assert.equal(redditFallback.ok, true);
assert.equal(redditFallback.backend, "rdt-cli");

cliCalls = 0;
const webFallback = await searchPlatform(
  "web",
  "typescript security",
  10,
  {
    allowCli: false,
    cliRunner: forbiddenCli,
    fetchOptions: options(async () => new Response("search via HTTP")),
  },
);
assert.equal(webFallback.ok, true);
assert.equal(webFallback.backend, "jina-ddg");
assert.equal(cliCalls, 0, "read-only web search must not trigger mcporter");

let youtubeSearchArgs: string[] = [];
const boundedSearch = await searchPlatform(
  "youtube",
  "typescript",
  999,
  {
    allowCli: true,
    cliRunner: async (_command, args) => {
      youtubeSearchArgs = args;
      return { stdout: '{"id":"one"}\nnot-json', stderr: "", code: 0 };
    },
  },
);
assert.equal(boundedSearch.ok, true);
assert.match(youtubeSearchArgs[0] ?? "", /^ytsearch50:/, "native search must clamp limits to 50");
assert.deepEqual(boundedSearch.data, [{ id: "one" }, "not-json"]);

console.log("Agent Reach native-channel security tests passed!");
