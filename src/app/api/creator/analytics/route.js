import { NextResponse } from "next/server.js";
import { getUserFromCookie } from "../../../../lib/api/auth.js";
import {
  buildCreatorAnalyticsKey,
  getOrComputeAnalytics,
  normalizeAnalyticsRange,
} from "../../../../lib/cache/creatorAnalytics.js";
import { computeCreatorAnalytics } from "../../../../lib/backend/creatorAnalytics.js";
import { logger } from "../../../../lib/logger.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseDateRange(url) {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  return normalizeAnalyticsRange({
    from,
    to,
    fromProvided: Boolean(fromParam),
    toProvided: Boolean(toParam),
  });
}

/**
 * GET /api/creator/analytics
 *
 * Get aggregated analytics for the authenticated creator.
 *
 * @swagger
 * /api/creator/analytics:
 *   get:
 *     summary: Get creator analytics dashboard data
 *     tags: [Creators]
 *     description: Returns revenue, sales counts, chart data, top materials, and withdrawals.
 *     parameters:
 *       - name: from
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range (defaults to 30 days ago)
 *       - name: to
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range (defaults to now)
 *     responses:
 *       200:
 *         description: Creator analytics data
 *       401:
 *         description: Unauthorized
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
    const { from, to } = parseDateRange(url);
    const granularity = url.searchParams.get("granularity") || "day";
    const cacheKey = buildCreatorAnalyticsKey({ creator: creatorAddress, from, to, granularity });

    // The route only owns auth, params and the response. All aggregation lives in
    // src/lib/backend/creatorAnalytics.js and is cached via the analytics cache.
    const { data, cacheHit } = await getOrComputeAnalytics({
      key: cacheKey,
      creator: creatorAddress,
      ttlSeconds: undefined,
      compute: () => computeCreatorAnalytics(creatorAddress, from, to),
    });

    return NextResponse.json(data, {
      headers: { "X-Analytics-Cache": cacheHit ? "HIT" : "MISS" },
    });
  } catch (error) {
    logger.error("[analytics] GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
