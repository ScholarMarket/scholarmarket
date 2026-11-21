export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auditLog } from "@/lib/api/audit";
import { withApiHardening } from "@/lib/api/hardening";
import { verifyAdminAuth } from "@/lib/auth/adminAuth";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { invalidateMarketplaceCache } from "@/lib/cache/redis";

export async function DELETE(request, context) {
  return withApiHardening(
    request,
    { route: "admin/materials/delete", rateLimit: { limit: 60, windowMs: 60_000 } },
    async () => {
      try {
        const auth = await verifyAdminAuth(request);
        if (!auth.authorized) {
          auditLog({ event: "admin_unauthorized", route: "admin/materials/delete", method: "DELETE", status: auth.status || 403 });
          return NextResponse.json({ error: auth.error || "Forbidden: Admin access required" }, { status: auth.status || 403 });
        }

        const params = await Promise.resolve(context?.params);
        const materialId = params?.id;

        if (!materialId || !ObjectId.isValid(materialId)) {
          return NextResponse.json({ error: "Invalid material ID" }, { status: 400 });
        }

        const db = await getDb();
        const material = await db.collection("materials").findOne({ _id: new ObjectId(materialId) });
        if (!material) {
          return NextResponse.json({ error: "Material not found" }, { status: 404 });
        }

        const adminActor = auth.user.walletAddress || auth.user.sub || "admin";
        await db.collection("materials").updateOne(
          { _id: new ObjectId(materialId), deletedAt: null },
          { $set: { deletedAt: new Date(), deletedBy: adminActor } }
        );

        auditLog({
          event: "material_deleted",
          route: "admin/materials/delete",
          method: "DELETE",
          status: 200,
          actor: adminActor,
          materialId,
        });

        await invalidateMarketplaceCache();

        return NextResponse.json({
          success: true,
          message: "Material deleted successfully",
          materialId,
        });
      } catch (err) {
        auditLog({
          event: "admin_delete_failed",
          route: "admin/materials/delete",
          method: "DELETE",
          status: 500,
          reason: err.message,
        });
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }
    }
  );
}
