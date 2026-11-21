import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
const mocks = vi.hoisted(() => ({
  findOne: vi.fn(), updateOne: vi.fn(), auth: vi.fn(), admin: vi.fn(), audit: vi.fn(), invalidate: vi.fn(), entitlement: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({ collection: () => mocks }) }));
vi.mock("@/lib/api/auth", () => ({ getUserFromCookie: mocks.auth }));
vi.mock("@/lib/auth/adminAuth", () => ({ verifyAdminAuth: mocks.admin }));
vi.mock("@/lib/api/hardening", () => ({ withApiHardening: (_r, _o, handler) => handler() }));
vi.mock("@/lib/api/audit", () => ({ auditLog: mocks.audit }));
vi.mock("@/lib/cache/redis", () => ({ invalidateMarketplaceCache: mocks.invalidate, cacheGet: vi.fn(), cacheSet: vi.fn() }));
vi.mock("@/lib/backend/priceDropNotifications", () => ({ notifyPriceDrop: vi.fn() }));
vi.mock("@/lib/entitlement", () => ({ verifyEntitlement: mocks.entitlement }));
vi.mock("@/lib/config/chain", () => ({ getIpfsUrl: cid => `https://example.com/ipfs/${cid}` }));
import { DELETE as creatorDelete } from "@/app/api/materials/route";
import { DELETE as adminDelete } from "@/app/api/admin/materials/[id]/route";
import { POST as restore } from "@/app/api/admin/materials/[id]/restore/route";
import { GET as download } from "@/app/api/materials/download/[id]/route";
import { buildMarketplaceDiscoveryQuery } from "@/lib/backend/marketplaceDiscovery";
const id = "507f1f77bcf86cd799439011";
const context = { params: Promise.resolve({ id }) };
const request = () => new Request(`https://example.com/api/materials?id=${id}`, { method: "DELETE" });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ walletAddress: "owner" });
  mocks.admin.mockResolvedValue({ authorized: true, user: { sub: "admin" } });
  mocks.findOne.mockResolvedValue({ _id: new ObjectId(id), userAddress: "owner", storageKey: "retained-file" });
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
});
describe("material soft deletion", () => {
  it.each([["creator", creatorDelete, "owner"], ["admin", adminDelete, "admin"]])("%s retains the record and file", async (_name, handler, actor) => {
    expect((await handler(request(), context)).status).toBe(200);
    expect(mocks.updateOne).toHaveBeenCalledWith({ _id: new ObjectId(id), deletedAt: null }, { $set: { deletedAt: expect.any(Date), deletedBy: actor } });
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "material_deleted", materialId: id }));
  });
  it("hides deleted listings from all discovery searches", () => {
    expect(buildMarketplaceDiscoveryQuery(new URLSearchParams("search=calc"))).toMatchObject({ deletedAt: null });
  });
  it("rejects deletion by another creator", async () => {
    mocks.auth.mockResolvedValue({ walletAddress: "other" });
    expect((await creatorDelete(request())).status).toBe(403);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
  it("restores atomically only within the 30-day window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    try {
      expect((await restore(request(), context)).status).toBe(200);
      expect(mocks.updateOne).toHaveBeenCalledWith({ _id: new ObjectId(id), deletedAt: { $gte: new Date("2026-10-22T12:00:00Z"), $lte: new Date() } }, { $unset: { deletedAt: "", deletedBy: "" }, $set: { updatedAt: new Date() } });
    } finally { vi.useRealTimers(); }
  });
  it("rejects expired or missing deletions", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect((await restore(request(), context)).status).toBe(404);
  });
  it("requires admin authentication to restore", async () => {
    mocks.admin.mockResolvedValue({ authorized: false, status: 403 });
    expect((await restore(request(), context)).status).toBe(403);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
  it.each([true, false])("checks existing buyer entitlement for deleted free materials: %s", async hasAccess => {
    mocks.auth.mockResolvedValue({ walletAddress: "buyer" });
    mocks.findOne.mockResolvedValue({ deletedAt: new Date(), price: 0, visibility: "public", storageKey: "retained-file" });
    mocks.entitlement.mockResolvedValue({ hasAccess, source: "purchases-db" });
    const response = await download(request(), context);
    expect(response.status).toBe(hasAccess ? 200 : 403);
    expect(mocks.entitlement).toHaveBeenCalledWith(id, "buyer");
    if (hasAccess) expect((await response.json()).downloadUrl).toContain("retained-file");
  });
});
