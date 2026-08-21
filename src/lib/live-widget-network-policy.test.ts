import { describe, expect, it } from "vitest";
import { isAddressAllowed, parseAllowedCidrs, resolveAllowedAddresses, validateRedirectTarget } from "./live-widget-network-policy";

describe("Live Widget network policy", () => {
  it("blocks local, metadata and IPv6 private targets by default", () => {
    expect(isAddressAllowed("127.0.0.1", "")).toBe(false);
    expect(isAddressAllowed("169.254.169.254", "")).toBe(false);
    expect(isAddressAllowed("100.100.100.200", "100.64.0.0/10")).toBe(false);
    expect(isAddressAllowed("10.0.0.5", "")).toBe(false);
    expect(isAddressAllowed("fc00::1", "")).toBe(false);
    expect(isAddressAllowed("fe80::1", "fc00::/7 fe80::/10")).toBe(false);
    expect(isAddressAllowed("fd00:ec2::254", "fc00::/7")).toBe(false);
    expect(isAddressAllowed("8.8.8.8", "")).toBe(true);
  });
  it("allows explicit LAN CIDR but never hard-denied ranges", () => {
    expect(isAddressAllowed("192.168.110.20", "192.168.110.0/24")).toBe(true);
    expect(isAddressAllowed("192.168.111.20", "192.168.110.0/24")).toBe(false);
    expect(isAddressAllowed("127.0.0.1", "0.0.0.0/0")).toBe(false);
    expect(isAddressAllowed("169.254.169.254", "0.0.0.0/0")).toBe(false);
  });
  it("rejects a hostname if any DNS answer violates policy", async () => {
    const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }, { address: "127.0.0.1", family: 4 as const }];
    await expect(resolveAllowedAddresses("example.test", "", resolver as never)).rejects.toMatchObject({ status: 403 });
  });
  it("revalidates redirects and blocks public-to-private rebinding", async () => {
    const resolver = async (hostname: string) => [{ address: hostname === "private.test" ? "192.168.1.5" : "93.184.216.34", family: 4 as const }];
    await expect(validateRedirectTarget(new URL("https://public.test/status"), "http://private.test/admin", "", resolver as never)).rejects.toMatchObject({ status: 403 });
    await expect(validateRedirectTarget(new URL("https://public.test/status"), "file:///etc/passwd", "", resolver as never)).rejects.toMatchObject({ status: 400 });
  });
  it("validates CIDRs", () => {
    expect(parseAllowedCidrs("10.0.0.0/8\n192.168.1.0/24")).toHaveLength(2);
    expect(() => parseAllowedCidrs("10.0.0.0/99")).toThrow();
  });
});
