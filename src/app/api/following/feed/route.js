import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getUserFromCookie } from "@/lib/api/auth";
import { withApiHardening } from "@/lib/api/hardening";
import { canonicalAddress } from "@/lib/backend/creatorFollows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return withApiHardening(request, { route: "following-feed", rateLimit: { limit: 60, windowMs: 60_000 } }, async () => {
    const user = await getUserFromCookie(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const follower = canonicalAddress(user.walletAddress || user.address);
    if (!follower) return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
    const params = new URL(request.url).searchParams;
    const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 20));
    let cursor;
    if (params.has("cursor")) {
      try {
        const encoded = params.get("cursor");
        if (encoded.length > 512) throw new Error("Invalid cursor");
        cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
        if (!ObjectId.isValid(cursor.id) || !Number.isFinite(new Date(cursor.at).getTime())) throw new Error("Invalid cursor");
      } catch { return NextResponse.json({ error: "Invalid cursor" }, { status: 400 }); }
    }
    try {
      const db = await getDb();
      const follows = await db.collection("follows").find({ follower }).toArray();
      const query = { status: "published", visibility: "public", deletedAt: null,
        $expr: { $in: [{ $toLower: { $ifNull: ["$userAddress", "$ownerAddress"] } }, follows.map(follow => follow.creator)] },
      };
      if (cursor) query.$or = [
        { publishedAt: { $lt: new Date(cursor.at) } },
        { publishedAt: new Date(cursor.at), _id: { $lt: new ObjectId(cursor.id) } },
      ];
      const docs = await db.collection("materials").find(query, {
        projection: { title: 1, description: 1, shortSummary: 1, price: 1, author: 1,
          userAddress: 1, ownerAddress: 1, publishedAt: 1, thumbnailUrl: 1, subject: 1 },
      }).sort({ publishedAt: -1, _id: -1 }).limit(Math.floor(limit) + 1).toArray();
      const items = docs.slice(0, Math.floor(limit));
      const last = items.at(-1);
      const nextCursor = docs.length > limit ? Buffer.from(JSON.stringify({ at: last.publishedAt, id: String(last._id) })).toString("base64url") : null;
      return NextResponse.json({ items, nextCursor });
    } catch {
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  });
}
