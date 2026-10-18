import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
blockedAddresses.addSubnet("192.88.99.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");

const defaultDnsResolver: DnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function normalizedHostname(parsed: URL): string {
  const hostname = parsed.hostname.toLowerCase();
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isExplicitLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized.startsWith("127.");
}

export function addressBlocked(address: string, allowLoopback = false): boolean {
  const family = isIP(address);
  if (!family) return true;
  const type = family === 4 ? "ipv4" : "ipv6";

  if (allowLoopback) {
    if (family === 4 && address.startsWith("127.")) return false;
    if (family === 6 && address === "::1") return false;
  }

  if (blockedAddresses.check(address, type)) return true;
  if (family === 6) {
    const firstGroup = Number.parseInt(address.split(":", 1)[0] || "0", 16);
    return firstGroup < 0x2000 || firstGroup > 0x3fff;
  }
  return false;
}

export function parseWebUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL format: ${urlStr}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Blocked unsafe scheme "${protocol}". Only http: and https: are allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Blocked URL containing embedded credentials.");
  }
  return parsed;
}

export function validateWebUrl(urlStr: string): string {
  const parsed = parseWebUrl(urlStr);
  const hostname = normalizedHostname(parsed);
  if (isExplicitLocalHost(hostname)) return parsed.href;

  const family = isIP(hostname);
  if (family && addressBlocked(hostname, false)) {
    throw new Error(`Blocked SSRF request to non-public address: ${hostname}`);
  }
  return parsed.href;
}

export async function assertSafeResolvedHost(
  parsed: URL,
  allowLoopback = false,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<void> {
  const hostname = normalizedHostname(parsed);

  if (isExplicitLocalHost(hostname)) {
    if (allowLoopback) return;
    throw new Error(`Blocked SSRF request to loopback address: ${hostname}`);
  }

  const family = isIP(hostname);
  if (family) {
    if (addressBlocked(hostname, allowLoopback)) {
      throw new Error(`Blocked SSRF request to non-public address: ${hostname}`);
    }
    return;
  }

  let resolved: ResolvedAddress[];
  try {
    resolved = await resolver(hostname);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve ${hostname}: ${reason}`);
  }

  if (resolved.length === 0) {
    throw new Error(`Could not resolve ${hostname}.`);
  }

  for (const address of resolved) {
    if (addressBlocked(address.address, allowLoopback)) {
      throw new Error(`Blocked SSRF request: ${hostname} resolved to non-public address ${address.address}`);
    }
  }
}

export async function assertSafeWebUrl(
  urlStr: string,
  allowLoopback = false,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<string> {
  const parsed = parseWebUrl(urlStr);
  await assertSafeResolvedHost(parsed, allowLoopback, resolver);
  return parsed.href;
}
