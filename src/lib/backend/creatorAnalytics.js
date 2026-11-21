import { getDb } from "../mongodb.js";
import { logger } from "../logger.js";

/**
 * Creator analytics aggregation service.
 *
 * Everything that is reusable and free of side effects is exported as a small,
 * named, unit-testable builder: constants, helpers, query builders, aggregation
 * pipeline builders, and response shapers. The only function that touches the
 * database is `computeCreatorAnalytics`, which composes those builders. The
 * analytics route (and the analytics cache) call it, and the export route
 * reuses the builders for its own record shaping.
 *
 * Convention for new analytics work: prefer adding a pure builder here and
 * calling it from `computeCreatorAnalytics` rather than inlining pipelines in
 * the route. Always pair entry/scroll Framer Motion animations with `opacity`
 * — see CONTRIBUTING.md — though that is unrelated to this backend module.
 */

// ---- Status constants ----

/** Purchase statuses that count as a completed sale. */
export const COMPLETED_PURCHASE_STATUSES = ["confirmed", "settled", "completed"];
/** Purchase statuses that are not yet settled. */
export const INCOMPLETE_PURCHASE_STATUSES = ["pending", "indexing"];
/** Refund statuses excluded from analytics/export (already resolved). */
export const REFUND_EXCLUDED_STATUSES = ["rejected", "cancelled"];
/** Weekday labels for the rolling 7-day chart, indexed by Date#getDay(). */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---- Pure helpers ----

/**
 * Returns the stringified identifier(s) for a material. Materials may be
 * referenced by either `_id` or `materialId`, so both are returned (deduped by
 * callers via a Set) so purchases saved under either key still match.
 */
export function buildMaterialKeys(material) {
  return [material?._id, material?.materialId]
    .filter(Boolean)
    .map((value) => String(value));
}

/** Sum of views, downloads and reviews for a material, tolerating field aliases. */
export function getMaterialActivity(material) {
  return (
    Number(material.views ?? material.viewCount ?? 0) +
    Number(material.downloads ?? material.downloadCount ?? 0) +
    Number(material.reviewsCount ?? material.reviewCount ?? 0)
  );
}

export function formatCurrency(amount) {
  return `$${Number(amount ?? 0).toFixed(2)}`;
}

export function formatDate(date) {
  if (!date) return "Unknown";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** True when a purchase document represents a refund (used by the export route). */
export function isRefundedPurchase(purchase) {
  return purchase?.status === "refunded" || purchase?.settlementState === "Refunded";
}

/** Midnight (local) six days ago — the start of the rolling 7-day chart window. */
export function startOfSevenDayWindow(reference = new Date()) {
  const start = new Date(reference);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Empty 7-day chart used when a creator has no materials yet. */
export function buildEmptyChart(reference = new Date()) {
  const start = startOfSevenDayWindow(reference);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return {
      day: DAY_LABELS[day.getDay()],
      revenue: 0,
      orders: 0,
      uploads: 0,
      interest: 0,
    };
  });
}

// ---- Pure query builders ----

/** Match completed purchases for the given material ids. */
export function buildCompletedMatch(materialIdStrings) {
  return {
    materialId: { $in: materialIdStrings },
    status: { $in: COMPLETED_PURCHASE_STATUSES },
  };
}

/** Match purchases still in flight for the given material ids. */
export function buildIncompleteMatch(materialIdStrings) {
  return {
    materialId: { $in: materialIdStrings },
    status: { $in: INCOMPLETE_PURCHASE_STATUSES },
  };
}

/** Match refund docs for a creator's materials or the creator directly. */
export function buildRefundsQuery(materialIdStrings, creatorAddress) {
  return {
    $or: [
      { materialId: { $in: materialIdStrings } },
      { creatorAddress },
    ],
    status: { $nin: REFUND_EXCLUDED_STATUSES },
  };
}

/** Match saved-material docs for the given material ids. */
export function buildSavedMaterialsQuery(materialIdStrings) {
  return { materialId: { $in: materialIdStrings } };
}

/** Match payouts for a creator. */
export function buildPayoutsQuery(creatorAddress) {
  return { creatorAddress };
}

// ---- Pure aggregation pipeline builders ----

/** Sum total revenue and count across all completed purchases. */
export function buildAllTimeRevenuePipeline(completedMatch) {
  return [
    { $match: completedMatch },
    {
      $group: {
        _id: null,
        total: { $sum: { $toDouble: "$amount" } },
        count: { $sum: 1 },
      },
    },
  ];
}

/** Count completed purchases within the requested date range. */
export function buildMonthlySalesPipeline(completedMatch, from, to) {
  return [
    {
      $match: {
        ...completedMatch,
        purchasedAt: { $gte: from, $lte: to },
      },
    },
    { $count: "count" },
  ];
}

/** Group in-flight purchases by status to derive pending/indexing counts. */
export function buildIncompletePipeline(materialIdStrings) {
  return [
    { $match: buildIncompleteMatch(materialIdStrings) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ];
}

/** Bucket completed purchases by day across the rolling 7-day window. */
export function buildChartPipeline(completedMatch, sevenDaysAgo) {
  return [
    {
      $match: {
        ...completedMatch,
        purchasedAt: { $gte: sevenDaysAgo },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$purchasedAt" } },
        revenue: { $sum: { $toDouble: "$amount" } },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];
}

/** Rank materials by sales (and revenue) to surface the top performers. */
export function buildTopMaterialsPipeline(completedMatch, limit = 10) {
  return [
    { $match: completedMatch },
    {
      $group: {
        _id: "$materialId",
        sales: { $sum: 1 },
        revenue: { $sum: { $toDouble: "$amount" } },
      },
    },
    { $sort: { sales: -1 } },
    { $limit: limit },
  ];
}

/** Sum amounts for purchases that were refunded, to net them out of revenue. */
export function buildPurchasesRefundsPipeline(materialIdStrings) {
  return [
    {
      $match: {
        materialId: { $in: materialIdStrings },
        $or: [{ status: "refunded" }, { settlementState: "Refunded" }],
      },
    },
    { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } },
  ];
}

// ---- Pure response shapers ----

/** Map every material key to its title (used to label recent orders). */
export function buildMaterialTitleMap(creatorMaterials) {
  const materialTitleMap = new Map();
  for (const material of creatorMaterials) {
    const keys = buildMaterialKeys(material);
    const title = material.title || "Untitled material";
    for (const key of keys) {
      materialTitleMap.set(key, title);
    }
  }
  return materialTitleMap;
}

/** Unique stringified material ids across a creator's materials. */
export function resolveMaterialIdStrings(creatorMaterials) {
  return [...new Set(creatorMaterials.flatMap(buildMaterialKeys))];
}

/** Count saved-material docs per materialId string. */
export function countSavesByMaterial(savedDocs) {
  const saveCounts = new Map();
  for (const doc of savedDocs) {
    const key = String(doc.materialId);
    saveCounts.set(key, (saveCounts.get(key) ?? 0) + 1);
  }
  return saveCounts;
}

/** Build the top-materials card list, ranked by sales, saves, then activity. */
export function buildTopMaterials(creatorMaterials, topMaterialsAgg, saveCounts) {
  const salesByMaterial = new Map();
  for (const material of topMaterialsAgg) {
    salesByMaterial.set(String(material._id), {
      sales: material.sales ?? 0,
      revenue: material.revenue ?? 0,
    });
  }

  return creatorMaterials
    .map((material) => {
      const keys = buildMaterialKeys(material);
      const key = keys[0];
      const totals = keys.reduce(
        (current, materialKey) => {
          const next = salesByMaterial.get(materialKey);
          return {
            sales: current.sales + (next?.sales ?? 0),
            revenue: current.revenue + (next?.revenue ?? 0),
          };
        },
        { sales: 0, revenue: 0 }
      );
      const saves = buildMaterialKeys(material).reduce(
        (total, materialKey) => total + (saveCounts.get(materialKey) ?? 0),
        0
      );
      const activity = getMaterialActivity(material);
      return {
        id: key,
        name: material.title || "Untitled material",
        sales: totals.sales,
        completedOrders: totals.sales,
        learnerInterest: saves,
        activity,
        revenue: formatCurrency(totals.revenue),
        visibility: material.visibility || "private",
        uploadedAt: material.createdAt || null,
      };
    })
    .sort((a, b) => {
      if (b.completedOrders !== a.completedOrders) return b.completedOrders - a.completedOrders;
      if (b.learnerInterest !== a.learnerInterest) return b.learnerInterest - a.learnerInterest;
      if (b.activity !== a.activity) return b.activity - a.activity;
      return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
    })
    .slice(0, 5);
}

/** Merge purchase buckets, material uploads and saves into the 7-day chart. */
export function buildChartData({ chartAgg, creatorMaterials, savedDocs, sevenDaysAgo }) {
  const chartMap = Object.fromEntries(
    chartAgg.map((d) => [d._id, { revenue: d.revenue ?? 0, orders: d.orders ?? 0 }])
  );
  const uploadMap = new Map();
  const interestMap = new Map();

  for (const material of creatorMaterials) {
    const createdAt = new Date(material.createdAt || 0);
    if (!Number.isNaN(createdAt.getTime()) && createdAt >= sevenDaysAgo) {
      const key = createdAt.toISOString().slice(0, 10);
      uploadMap.set(key, (uploadMap.get(key) ?? 0) + 1);
    }
  }

  for (const saved of savedDocs) {
    const savedAt = new Date(saved.savedAt || 0);
    if (!Number.isNaN(savedAt.getTime()) && savedAt >= sevenDaysAgo) {
      const key = savedAt.toISOString().slice(0, 10);
      interestMap.set(key, (interestMap.get(key) ?? 0) + 1);
    }
  }

  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sevenDaysAgo);
    day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    return {
      day: DAY_LABELS[day.getDay()],
      revenue: chartMap[key]?.revenue ?? 0,
      orders: chartMap[key]?.orders ?? 0,
      uploads: uploadMap.get(key) ?? 0,
      interest: interestMap.get(key) ?? 0,
    };
  });
}

/** Shape recent purchase docs into the recent-orders card list. */
export function buildRecentOrders(recentOrdersDocs, materialTitleMap) {
  return recentOrdersDocs.map((order) => {
    const materialId = String(order.materialId);
    return {
      id: String(order._id || `${materialId}-${order.buyerAddress || "buyer"}`),
      material: materialTitleMap.get(materialId) || "Unknown material",
      buyer: order.buyerAddress || "Unknown buyer",
      amount: formatCurrency(order.amount),
      status: order.status || "completed",
      date: formatDate(order.purchasedAt || order.createdAt || order.updatedAt),
    };
  });
}

/** Zeroed analytics payload returned when a creator has no materials. */
export function buildEmptyAnalytics(from, to) {
  return {
    totalRevenue: 0,
    totalSales: 0,
    monthlySales: 0,
    pendingCount: 0,
    indexingCount: 0,
    uploadCount: 0,
    publishedCount: 0,
    draftCount: 0,
    materialActivity: 0,
    learnerInterest: 0,
    savedCount: 0,
    completedOrders: 0,
    hasActivity: false,
    chartData: buildEmptyChart(),
    topMaterials: [],
    recentOrders: [],
    withdrawals: [],
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
}

// ---- DB helpers ----

const MATERIAL_PROJECTION = {
  _id: 1,
  materialId: 1,
  title: 1,
  visibility: 1,
  price: 1,
  createdAt: 1,
  updatedAt: 1,
  views: 1,
  viewCount: 1,
  downloads: 1,
  downloadCount: 1,
  reviewsCount: 1,
  reviewCount: 1,
};

/** Fetch a creator's materials with only the fields the aggregations need. */
export async function fetchCreatorMaterials(db, creatorAddress) {
  return db
    .collection("materials")
    .find({ userAddress: creatorAddress }, { projection: MATERIAL_PROJECTION })
    .toArray();
}

/** Like collection.find(query).toArray() but degrades to [] on driver errors. */
async function safeFindArray(collection, query, options) {
  try {
    return await collection.find(query, options).toArray();
  } catch {
    return [];
  }
}

// ---- Service ----

/**
 * Aggregates the full creator analytics payload for a date range. This is the
 * only function here that touches the database; it composes the pure builders
 * above. The analytics route computes (and caches) the result via this function.
 *
 * @param {string} creatorAddress Wallet address of the creator.
 * @param {Date}  from            Range start (already normalized by the route).
 * @param {Date}  to              Range end (already normalized by the route).
 * @returns {Promise<object>}     Analytics payload consumed by the dashboard.
 */
export async function computeCreatorAnalytics(creatorAddress, from, to) {
  try {
    const db = await getDb();
    const purchases = db.collection("purchases");

    const creatorMaterials = await fetchCreatorMaterials(db, creatorAddress);
    const materialIdStrings = resolveMaterialIdStrings(creatorMaterials);
    const materialTitleMap = buildMaterialTitleMap(creatorMaterials);

    if (materialIdStrings.length === 0) {
      return buildEmptyAnalytics(from, to);
    }

    const completedMatch = buildCompletedMatch(materialIdStrings);
    const sevenDaysAgo = startOfSevenDayWindow();

    const [
      allTimeAgg,
      monthlySalesAgg,
      incompleteAgg,
      chartAgg,
      topMaterialsAgg,
      recentOrdersDocs,
      savedDocs,
      refundsCollectionDocs,
      purchasesRefundsAgg,
    ] = await Promise.all([
      purchases.aggregate(buildAllTimeRevenuePipeline(completedMatch)).toArray(),
      purchases.aggregate(buildMonthlySalesPipeline(completedMatch, from, to)).toArray(),
      purchases.aggregate(buildIncompletePipeline(materialIdStrings)).toArray(),
      purchases.aggregate(buildChartPipeline(completedMatch, sevenDaysAgo)).toArray(),
      purchases.aggregate(buildTopMaterialsPipeline(completedMatch)).toArray(),
      purchases
        .find(completedMatch)
        .sort({ purchasedAt: -1, createdAt: -1, updatedAt: -1 })
        .limit(5)
        .toArray(),
      safeFindArray(
        db.collection("saved_materials"),
        buildSavedMaterialsQuery(materialIdStrings)
      ),
      safeFindArray(
        db.collection("refunds"),
        buildRefundsQuery(materialIdStrings, creatorAddress)
      ),
      purchases.aggregate(buildPurchasesRefundsPipeline(materialIdStrings)).toArray(),
    ]);

    const refundsCollSum = refundsCollectionDocs.reduce(
      (sum, r) => sum + (Number(r.amount) || 0),
      0
    );
    const purchasesRefundSum = purchasesRefundsAgg[0]?.total ?? 0;
    const totalRefunds = refundsCollSum + purchasesRefundSum;

    const grossRevenue = allTimeAgg[0]?.total ?? 0;
    const totalRevenue = Math.max(0, grossRevenue - totalRefunds);
    const totalSales = allTimeAgg[0]?.count ?? 0;
    const monthlySales = monthlySalesAgg[0]?.count ?? 0;
    const pendingCount = incompleteAgg.find((g) => g._id === "pending")?.count ?? 0;
    const indexingCount = incompleteAgg.find((g) => g._id === "indexing")?.count ?? 0;
    const savedCount = savedDocs.length;
    const learnerInterest = savedCount + pendingCount + indexingCount;
    const materialActivity = creatorMaterials.reduce(
      (total, material) => total + getMaterialActivity(material),
      0
    );
    const publishedCount = creatorMaterials.filter((m) => m.visibility !== "private").length;
    const draftCount = creatorMaterials.length - publishedCount;

    const saveCounts = countSavesByMaterial(savedDocs);
    const topMaterials = buildTopMaterials(creatorMaterials, topMaterialsAgg, saveCounts);
    const chartData = buildChartData({ chartAgg, creatorMaterials, savedDocs, sevenDaysAgo });
    const recentOrders = buildRecentOrders(recentOrdersDocs, materialTitleMap);

    let withdrawals = [];
    try {
      const payoutDocs = await db
        .collection("payouts")
        .find(buildPayoutsQuery(creatorAddress))
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      withdrawals = payoutDocs.map((p) => ({
        date: formatDate(p.createdAt),
        amount: formatCurrency(p.amount),
        status: p.status === "completed" ? "Success" : "Pending",
      }));
    } catch {
      withdrawals = [];
    }

    return {
      totalRevenue,
      totalSales,
      monthlySales,
      pendingCount,
      indexingCount,
      uploadCount: creatorMaterials.length,
      publishedCount,
      draftCount,
      materialActivity,
      learnerInterest,
      savedCount,
      completedOrders: totalSales,
      hasActivity:
        creatorMaterials.length > 0 ||
        totalSales > 0 ||
        learnerInterest > 0 ||
        materialActivity > 0,
      chartData,
      topMaterials,
      recentOrders,
      withdrawals,
      dateRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  } catch (error) {
    logger.error("[analytics] computeCreatorAnalytics error:", error);
    throw error;
  }
}
