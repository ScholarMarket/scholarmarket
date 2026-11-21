export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { verifyAdminAuth } from "@/lib/auth/adminAuth";
import { withApiHardening } from "@/lib/api/hardening";
import { auditLog } from "@/lib/api/audit";
import { getDb } from "@/lib/mongodb";
import { invalidateMarketplaceCache } from "@/lib/cache/redis";

export async function POST(request, context) {
  return withApiHardening(request, {
    route: "admin/materials/restore", rateLimit: { limit: 60, windowMs: 60_000 },
  }, async () => {
    try {
      const auth = await verifyAdminAuth(request);
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error || "Forbidden" }, { status: auth.status || 403 });
      }
      const { id } = await context.params;
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: "Invalid material ID" }, { status: 400 });
      }
      const db = await getDb();
      const now = new Date();
      const result = await db.collection("materials").updateOne({
        _id: new ObjectId(id),
        deletedAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), $lte: now },
      }, { $unset: { deletedAt: "", deletedBy: "" }, $set: { updatedAt: now } });
      if (!result.matchedCount) {
        return NextResponse.json({ error: "Deleted material not found within the 30-day restore window" }, { status: 404 });
      }
      await invalidateMarketplaceCache();
      auditLog({ event: "material_restored", route: "admin/materials/restore", method: "POST",
        status: 200, actor: auth.user.walletAddress || auth.user.sub, materialId: id });
      return NextResponse.json({ success: true, materialId: id });
    } catch (error) {
      auditLog({ event: "material_restore_failed", status: 500, reason: error.message });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  });
}
