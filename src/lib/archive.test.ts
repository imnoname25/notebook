import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeArchivePath, readJsonFile, writeRequestToFile } from "./archive";
import { contentDisposition, resolveStoragePath, safeDownloadName } from "./storage";

describe("archive and filename security", () => {
  it("accepts a relative archive path", () => expect(assertSafeArchivePath("attachments/image.png")).toBe("attachments/image.png"));
  it.each(["../secret", "attachments/../../secret", "/absolute", "C:/windows", "folder\\file", "x\0y"])("rejects unsafe path %s", (value) => expect(() => assertSafeArchivePath(value)).toThrow());
  it("sanitizes download headers", () => { expect(safeDownloadName('../../"note\r\n.txt')).toBe("_note_.txt"); expect(contentDisposition("заметка.md")).not.toContain("\r"); });
  it("never resolves storage traversal", () => expect(() => resolveStoragePath("../outside")).toThrow());
  it("enforces the streamed request limit instead of trusting Content-Length", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "notebook-limit-test-")); const previous = process.env.MAX_IMPORT_SIZE_MB; process.env.MAX_IMPORT_SIZE_MB = "0.000001";
    try { await expect(writeRequestToFile(new Request("http://local/import", { method: "POST", body: "more than one byte" }), path.join(directory, "upload.bin"))).rejects.toMatchObject({ status: 413 }); }
    finally { if (previous === undefined) delete process.env.MAX_IMPORT_SIZE_MB; else process.env.MAX_IMPORT_SIZE_MB = previous; await rm(directory, { recursive: true, force: true }); }
  });
  it("returns a safe client error for malformed JSON", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "notebook-json-test-")); const target = path.join(directory, "bad.json");
    try { await writeFile(target, "{not-json"); await expect(readJsonFile(target)).rejects.toMatchObject({ status: 400 }); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
