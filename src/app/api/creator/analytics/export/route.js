import { NextResponse } from "next/server.js";
import { getDb } from "../../../../../lib/mongodb.js";
import { getUserFromCookie } from "../../../../../lib/api/auth.js";
import { logger } from "../../../../../lib/logger.js";
import {
  buildMaterialKeys,
  buildRefundsQuery,
  isRefundedPurchase,
} from "../../../../../lib/backend/creatorAnalytics.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * GET /api/creator/analytics/export
 *
 * Exports a creator's transaction activity (purchases, refunds, payouts) as a
 * CSV. The route owns auth, params and the CSV response; record shaping reuses
 * the shared builders from src/lib/backend/creatorAnalytics.js.
 */
export async function GET(request) {
  try {
    const user = await getUserFromCookie(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creatorAddress = user.walletAddress || user.address || user.id;
    if (!creatorAddress) {
      return NextResponse.json({ error: "No wallet address on account" }, { status: 400 });
    }

    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const fromDate = fromParam ? new Date(fromParam) : null;
    const toDate = toParam ? new Date(toParam) : null;
    const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
    const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;
    if (validFrom && validTo && validFrom > validTo) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const db = await getDb();

    // 1. Materials owned by this creator -> material id strings.
    const materials = await db
      .collection("materials")
      .find({ userAddress: creatorAddress }, { projection: { materialId: 1, _id: 1 } })
      .toArray();
    const materialIdStrings = [...new Set(materials.flatMap(buildMaterialKeys))];

    // 2. Purchases for these materials (date filtering is applied to the records below).
    let purchases = [];
    if (materialIdStrings.length > 0) {
      purchases = await db
        .collection("purchases")
        .find({ materialId: { $in: materialIdStrings } })
        .sort({ purchasedAt: -1, createdAt: -1 })
        .toArray();
    }

    // 3. Payouts for this creator.
    const payouts = await db
      .collection("payouts")
      .find({ creatorAddress })
      .sort({ createdAt: -1 })
      .toArray();

    // 4. Refunds for this creator's materials (shared query builder).
    let refunds = [];
    if (materialIdStrings.length > 0) {
      refunds = await db
        .collection("refunds")
        .find(buildRefundsQuery(materialIdStrings, creatorAddress))
        .sort({ createdAt: -1 })
        .toArray();
    }

    // 5. Combine purchases, refunds and payouts into a single record list.
    const records = [];

    for (const p of purchases) {
      const date = new Date(p.purchasedAt || p.createdAt || p.updatedAt || 0).toISOString();
      const refunded = isRefundedPurchase(p);
      const rawPrice = Number(p.amount) || 0;
      records.push({
        date,
        itemId: String(p.materialId || "Unknown"),
        buyerWallet: String(p.buyerAddress || "Unknown"),
        price: refunded ? `-${Math.abs(rawPrice)}` : String(rawPrice),
        paidAsset: p.currency || p.asset || "XLM",
        status: refunded ? "refunded" : p.status || "completed",
      });
    }

    for (const r of refunds) {
      const date = new Date(r.createdAt || r.approvedAt || r.updatedAt || 0).toISOString();
      const rawAmount = Number(r.amount) || 0;
      records.push({
        date,
        itemId: String(r.materialId || "Refund"),
        buyerWallet: String(r.buyerAddress || "Unknown"),
        price: `-${Math.abs(rawAmount)}`,
        paidAsset: r.asset || r.currency || "XLM",
        status: "refunded",
      });
    }

    for (const p of payouts) {
      const date = new Date(p.createdAt || p.updatedAt || 0).toISOString();
      records.push({
        date,
        itemId: "Payout",
        buyerWallet: "ScholarMarket",
        price: `-${p.amount || 0}`,
        paidAsset: p.currency || "XLM",
        status: p.status || "completed",
      });
    }

    // 6. Filter by the requested date range, then sort newest first.
    let filteredRecords = records;
    if (validFrom || validTo) {
      filteredRecords = records.filter((r) => {
        const itemTime = new Date(r.date).getTime();
        if (validFrom && itemTime < validFrom.getTime()) return false;
        if (validTo && itemTime > validTo.getTime()) return false;
        return true;
      });
    }
    filteredRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 7. Build the CSV with RFC 4180 escaping.
    const headers = ["Date", "Item ID", "Buyer Wallet", "Price", "Paid Asset", "Status"];
    const csvRows = [headers.map(escapeCsvCell).join(",")];
    for (const r of filteredRecords) {
      csvRows.push(
        [
          escapeCsvCell(r.date),
          escapeCsvCell(r.itemId),
          escapeCsvCell(r.buyerWallet),
          String(r.price),
          escapeCsvCell(r.paidAsset),
          escapeCsvCell(r.status),
        ].join(",")
      );
    }
    const csvString = csvRows.join("\n");

    return new NextResponse(csvString, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="scholarmarket-analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    logger.error("[analytics/export] GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
