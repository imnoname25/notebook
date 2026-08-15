import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testWebdavConnection, uploadBackupToWebdav } from "./webdav";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const config = { url: "https://dav.example.test/root", username: "admin", password: "secret", remoteDirectory: "notebook" };
describe("WebDAV", () => {
  it("tests access with a small probe and removes it", async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 207 })).mockResolvedValueOnce(new Response(null, { status: 201 })).mockResolvedValueOnce(new Response(null, { status: 204 })); await expect(testWebdavConnection(config, fetcher)).resolves.toEqual({ ok: true }); expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(["PROPFIND", "PUT", "DELETE"]); expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toMatch(/^Basic /); });
  it("categorizes authentication and timeout failures", async () => { await expect(testWebdavConnection(config, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })))).rejects.toThrow("unauthorized"); await expect(testWebdavConnection(config, vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timeout", "TimeoutError")))).rejects.toThrow("timeout"); });
  it("streams a backup and returns ETag", async () => { const directory = await mkdtemp(path.join(tmpdir(), "notebook-webdav-test-")); directories.push(directory); const target = path.join(directory, "backup.zip"); await writeFile(target, "zip"); const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 207 })).mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: "abc" } })); await expect(uploadBackupToWebdav(config, "notebook-backup.zip", target, 3n, fetcher)).resolves.toEqual({ etag: "abc" }); });
  it("does not follow a redirect to another origin", async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { location: "https://evil.example/" } })); await expect(testWebdavConnection(config, fetcher)).rejects.toThrow("другой origin"); });
});

