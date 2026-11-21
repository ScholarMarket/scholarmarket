import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getUserFromCookie } from "@/lib/api/auth";
import { withApiHardening } from "@/lib/api/hardening";
import { normalizeWalletAddress } from "@/lib/api/validation";
import { canonicalAddress, setCreatorFollow } from "@/lib/backend/creatorFollows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function changeFollow(request, context, following) {
  return withApiHardening(request, { route: "creator-follow", rateLimit: { limit: 30, windowMs: 60_000 } }, async () => {
    const user = await getUserFromCookie(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { address } = await context.params;
    const creator = canonicalAddress(normalizeWalletAddress(address));
    const follower = canonicalAddress(normalizeWalletAddress(user.walletAddress || user.address));
    if (!creator || !follower) return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
    if (creator === follower) return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
    try {
      const db = await getDb();
      const exists = await db.collection("users").findOne({ $or: [
        { walletAddressLower: creator }, { walletAddress: { $regex: `^${creator}$`, $options: "i" } },
      ] });
      if (following && !exists) return NextResponse.json({ error: "Creator not found" }, { status: 404 });
      const followerCount = await setCreatorFollow(db, follower, creator, following);
      return NextResponse.json({ following, followerCount });
    } catch {
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  });
}
export const POST = (request, context) => changeFollow(request, context, true);
export const DELETE = (request, context) => changeFollow(request, context, false);
