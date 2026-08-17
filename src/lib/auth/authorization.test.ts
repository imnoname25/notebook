import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));

describe("authorization boundary", () => {
  beforeEach(() => getCurrentUser.mockReset());

  it("allows only administrators through requireAdmin", async () => {
    const { requireAdmin } = await import("@/lib/api");
    getCurrentUser.mockResolvedValue({ id: "admin", role: "ADMIN", mustChangePassword: false });
    await expect(requireAdmin()).resolves.toMatchObject({ id: "admin" });
    getCurrentUser.mockResolvedValue({ id: "user", role: "USER", mustChangePassword: false });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("blocks normal application access until a temporary password is changed", async () => {
    const { requireAccountUser, requireUser } = await import("@/lib/api");
    getCurrentUser.mockResolvedValue({ id: "user", role: "USER", mustChangePassword: true });
    await expect(requireUser()).rejects.toMatchObject({ status: 403 });
    await expect(requireAccountUser()).resolves.toMatchObject({ id: "user" });
  });
});
