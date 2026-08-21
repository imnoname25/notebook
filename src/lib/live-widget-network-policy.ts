import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { ApiError } from "@/lib/errors";

type IpValue = { family: 4 | 6; value: bigint };
type Cidr = IpValue & { bits: number };

function ipv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) throw new Error("INVALID_IP");
  return parts.reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
}

function ipv6(value: string) {
  const normalized = value.toLowerCase().split("%")[0]!;
  const mapped = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/u);
  const mappedValue = mapped ? ipv4(mapped[2]!) : 0n;
  const source = mapped ? `${mapped[1]}${(mappedValue >> 16n).toString(16)}:${(mappedValue & 0xffffn).toString(16)}` : normalized;
  const halves = source.split("::");
  if (halves.length > 2) throw new Error("INVALID_IP");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) throw new Error("INVALID_IP");
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) throw new Error("INVALID_IP");
  return groups.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

export function parseIp(value: string): IpValue {
  const family = isIP(value.split("%")[0]!);
  if (family === 4) return { family: 4, value: ipv4(value) };
  if (family === 6) return { family: 6, value: ipv6(value) };
  throw new Error("INVALID_IP");
}

export function parseCidr(value: string): Cidr {
  const [address, rawBits] = value.trim().split("/");
  const parsed = parseIp(address!);
  const max = parsed.family === 4 ? 32 : 128;
  const bits = rawBits === undefined ? max : Number(rawBits);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) throw new Error("INVALID_CIDR");
  return { ...parsed, bits };
}

export function cidrContains(cidr: Cidr, address: IpValue) {
  if (cidr.family !== address.family) return false;
  const total = cidr.family === 4 ? 32 : 128;
  if (cidr.bits === 0) return true;
  const shift = BigInt(total - cidr.bits);
  return (cidr.value >> shift) === (address.value >> shift);
}

const HARD_DENY = ["0.0.0.0/8", "100.100.100.200/32", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "::ffff:0:0/96", "fd00:ec2::254/128", "fe80::/10", "ff00::/8"].map(parseCidr);
const NON_PUBLIC = ["10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "fc00::/7", "2001:db8::/32"].map(parseCidr);

export function parseAllowedCidrs(value: string) {
  const entries = value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean);
  if (entries.length > 32) throw new Error("Разрешено не более 32 сетей");
  return entries.map(parseCidr);
}

export function isAddressAllowed(address: string, allowedCidrs: string) {
  const ip = parseIp(address);
  if (HARD_DENY.some((cidr) => cidrContains(cidr, ip))) return false;
  if (!NON_PUBLIC.some((cidr) => cidrContains(cidr, ip))) return true;
  return parseAllowedCidrs(allowedCidrs).some((cidr) => cidrContains(cidr, ip));
}

async function lookupWithTimeout(hostname: string, resolver: typeof dnsLookup) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolver(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), 5_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveAllowedAddresses(hostname: string, allowedCidrs: string, resolver: typeof dnsLookup = dnsLookup) {
  const literal = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }] : await lookupWithTimeout(hostname, resolver);
  if (!literal.length) throw new ApiError(400, "DNS не вернул адрес");
  if (literal.some(({ address }) => !isAddressAllowed(address, allowedCidrs))) throw new ApiError(403, "Адрес заблокирован политикой Live Widgets");
  return literal.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

export async function validateRedirectTarget(current: URL, location: string, allowedCidrs: string, resolver: typeof dnsLookup = dnsLookup) {
  const target = new URL(location, current);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new ApiError(400, "Redirect использует запрещённый URL");
  await resolveAllowedAddresses(target.hostname.replace(/^\[|\]$/g, ""), allowedCidrs, resolver);
  return target;
}
