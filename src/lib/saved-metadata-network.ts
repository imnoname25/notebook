import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cidrContains, isAddressAllowed, parseCidr, parseIp } from "@/lib/live-widget-network-policy";

const extraDenied = ["192.88.99.0/24", "2001::/23", "2002::/16", "3fff::/20"].map(parseCidr);
const globalV6 = parseCidr("2000::/3");
const redirects = new Set([301, 302, 303, 307, 308]);

export class SavedMetadataError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly reason: "destination" | "dns" | "redirect" | "http" | "mime" | "encoding" | "size" | "challenge",
    readonly httpStatus?: number,
  ) {
    super("Saved metadata request failed");
  }
}

export function publicMetadataAddress(address: string) {
  const ip = parseIp(address);
  return isAddressAllowed(address, "") && (ip.family === 4 || cidrContains(globalV6, ip))
    && !extraDenied.some(range => cidrContains(range, ip));
}

export function metadataUrl(value: string, base?: URL) {
  const url = new URL(value, base);
  const host = url.hostname.replace(/\.$/u, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port
    || /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/iu.test(host)
    || (!host.includes(".") && !host.startsWith("["))) throw new SavedMetadataError(false, "destination");
  const literal = host.replace(/^\[|\]$/gu, "");
  if (isIP(literal) && !publicMetadataAddress(literal)) throw new SavedMetadataError(false, "destination");
  url.hash = "";
  return url;
}

type Address = { address: string; family: number };
type Resolver = (host: string) => Promise<Address[]>;

export async function metadataTarget(url: URL, resolve: Resolver = host => lookup(host, { all: true, verbatim: true })) {
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await resolve(host);
  if (!addresses.length) throw new SavedMetadataError(true, "dns");
  if (addresses.some(target => ![4, 6].includes(target.family) || isIP(target.address) !== target.family
    || !publicMetadataAddress(target.address))) throw new SavedMetadataError(false, "destination");
  return addresses[0];
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

type Options = {
  maxBytes: number; types: readonly string[]; signal?: AbortSignal; rejectChallenge?: boolean;
  onBytes?: (bytes: number) => void;
};
type Response = Pick<http.IncomingMessage, "statusCode" | "headers"> & AsyncIterable<Buffer> & { destroy(): void };

function request(url: URL, target: Address, signal: AbortSignal, accept: string) {
  return new Promise<Response>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const options: http.RequestOptions & { autoSelectFamily: boolean } = {
      signal, agent: false, family: target.family, autoSelectFamily: false, maxHeaderSize: 16 * 1024,
      lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      headers: { accept, "accept-encoding": "identity", "user-agent": "Notebook-Saved/1" },
    };
    const outgoing = client.get(url, options, resolve);
    outgoing.on("error", reject);
  });
}

export async function fetchSavedMetadataResource(value: string, options: Options, network?: { resolve: Resolver; request: typeof request }) {
  const deadline = AbortSignal.timeout(8_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let url = metadataUrl(value);
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const target = await abortable(metadataTarget(url, network?.resolve), signal);
    const response = await (network?.request ?? request)(url, target, signal, options.types.join(", "));
    try {
      const status = response.statusCode ?? 0;
      if (options.rejectChallenge && response.headers["cf-mitigated"] === "challenge") {
        throw new SavedMetadataError(false, "challenge", status);
      }
      if (redirects.has(status)) {
        if (hop === 3 || !response.headers.location) throw new SavedMetadataError(false, "redirect");
        url = metadataUrl(response.headers.location, url);
        continue;
      }
      if (status !== 200) throw new SavedMetadataError(status === 408 || status === 429 || status >= 500, "http", status);
      const contentType = response.headers["content-type"] ?? "";
      const mimeType = contentType.split(";")[0].trim().toLowerCase();
      const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
      if (!options.types.includes(mimeType)) throw new SavedMetadataError(false, "mime");
      if (encoding && encoding !== "identity") throw new SavedMetadataError(false, "encoding");
      if (Number(response.headers["content-length"]) > options.maxBytes) throw new SavedMetadataError(false, "size");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response) {
        bytes += chunk.byteLength;
        options.onBytes?.(chunk.byteLength);
        if (bytes > options.maxBytes) throw new SavedMetadataError(false, "size");
        chunks.push(chunk);
      }
      return { body: Buffer.concat(chunks, bytes), mimeType, contentType, url };
    } finally {
      response.destroy();
    }
  }
  throw new SavedMetadataError(false, "redirect");
}
