// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COMPLETED_PURCHASE_STATUSES,
  INCOMPLETE_PURCHASE_STATUSES,
  REFUND_EXCLUDED_STATUSES,
  DAY_LABELS,
  buildMaterialKeys,
  getMaterialActivity,
  isRefundedPurchase,
  startOfSevenDayWindow,
  buildEmptyChart,
  buildCompletedMatch,
  buildIncompleteMatch,
  buildRefundsQuery,
  buildSavedMaterialsQuery,
  buildPayoutsQuery,
  buildAllTimeRevenuePipeline,
  buildMonthlySalesPipeline,
  buildIncompletePipeline,
  buildChartPipeline,
  buildTopMaterialsPipeline,
  buildPurchasesRefundsPipeline,
  resolveMaterialIdStrings,
  buildMaterialTitleMap,
  countSavesByMaterial,
  buildTopMaterials,
  buildChartData,
  buildRecentOrders,
  buildEmptyAnalytics,
} from "../creatorAnalytics.js";

const MATERIAL_IDS = ["m1", "m2"];
const COMPLETED_MATCH = buildCompletedMatch(MATERIAL_IDS);

describe("helpers", () => {
  it("buildMaterialKeys stringifies _id and materialId and drops falsy values", () => {
    expect(buildMaterialKeys({ _id: "abc", materialId: "m-1" })).toEqual(["abc", "m-1"]);
    expect(buildMaterialKeys({ _id: "only" })).toEqual(["only"]);
    expect(buildMaterialKeys({ materialId: "x" })).toEqual(["x"]);
    expect(buildMaterialKeys(null)).toEqual([]);
    expect(buildMaterialKeys(undefined)).toEqual([]);
  });

  it("getMaterialActivity sums views/downloads/reviews tolerating aliases", () => {
    expect(getMaterialActivity({ views: 10, downloads: 5, reviewsCount: 2 })).toBe(17);
    expect(getMaterialActivity({ viewCount: 1, downloadCount: 2, reviewCount: 3 })).toBe(6);
    expect(getMaterialActivity({})).toBe(0);
    expect(getMaterialActivity(null)).toBe(0);
  });

  it("isRefundedPurchase detects refunded status or Refunded settlement state", () => {
    expect(isRefundedPurchase({ status: "refunded" })).toBe(true);
    expect(isRefundedPurchase({ settlementState: "Refunded" })).toBe(true);
    expect(isRefundedPurchase({ status: "completed", settlementState: "Settled" })).toBe(false);
    expect(isRefundedPurchase(null)).toBe(false);
  });

  it("startOfSevenDayWindow is six calendar days earlier at local midnight", () => {
    const ref = new Date("2026-11-21T15:30:00");
    const start = startOfSevenDayWindow(ref);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getDate()).toBe(ref.getDate() - 6);
  });

  it("buildEmptyChart returns 7 zeroed buckets with valid weekday labels", () => {
    const ref = new Date("2026-11-21T12:00:00");
    const start = startOfSevenDayWindow(ref);
    const chart = buildEmptyChart(ref);
    expect(chart).toHaveLength(7);
    expect(
      chart.every((c) => c.revenue === 0 && c.orders === 0 && c.uploads === 0 && c.interest === 0)
    ).toBe(true);
    expect(chart[0].day).toBe(DAY_LABELS[start.getDay()]);
    expect(chart.every((c) => DAY_LABELS.includes(c.day))).toBe(true);
  });
});

describe("query builders", () => {
  it("buildCompletedMatch scopes to material ids and completed statuses", () => {
    expect(buildCompletedMatch(MATERIAL_IDS)).toEqual({
      materialId: { $in: MATERIAL_IDS },
      status: { $in: COMPLETED_PURCHASE_STATUSES },
    });
  });

  it("buildIncompleteMatch scopes to material ids and in-flight statuses", () => {
    expect(buildIncompleteMatch(MATERIAL_IDS)).toEqual({
      materialId: { $in: MATERIAL_IDS },
      status: { $in: INCOMPLETE_PURCHASE_STATUSES },
    });
  });

  it("buildRefundsQuery matches creator materials or creator, excluding resolved refunds", () => {
    expect(buildRefundsQuery(MATERIAL_IDS, "0xcreator")).toEqual({
      $or: [{ materialId: { $in: MATERIAL_IDS } }, { creatorAddress: "0xcreator" }],
      status: { $nin: REFUND_EXCLUDED_STATUSES },
    });
  });

  it("buildSavedMaterialsQuery scopes to material ids", () => {
    expect(buildSavedMaterialsQuery(MATERIAL_IDS)).toEqual({
      materialId: { $in: MATERIAL_IDS },
    });
  });

  it("buildPayoutsQuery scopes to creator address", () => {
    expect(buildPayoutsQuery("0xcreator")).toEqual({ creatorAddress: "0xcreator" });
  });
});

describe("pipeline builders", () => {
  it("buildAllTimeRevenuePipeline matches completed purchases and sums amount + count", () => {
    expect(buildAllTimeRevenuePipeline(COMPLETED_MATCH)).toEqual([
      { $match: COMPLETED_MATCH },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: "$amount" } },
          count: { $sum: 1 },
        },
      },
    ]);
  });

  it("buildMonthlySalesPipeline adds a purchasedAt range and counts", () => {
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-30T00:00:00Z");
    expect(buildMonthlySalesPipeline(COMPLETED_MATCH, from, to)).toEqual([
      { $match: { ...COMPLETED_MATCH, purchasedAt: { $gte: from, $lte: to } } },
      { $count: "count" },
    ]);
  });

  it("buildIncompletePipeline matches in-flight statuses and groups by status", () => {
    expect(buildIncompletePipeline(MATERIAL_IDS)).toEqual([
      {
        $match: {
          materialId: { $in: MATERIAL_IDS },
          status: { $in: INCOMPLETE_PURCHASE_STATUSES },
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
  });

  it("buildChartPipeline buckets completed purchases by day within the window", () => {
    const sevenDaysAgo = new Date("2026-11-15T00:00:00Z");
    expect(buildChartPipeline(COMPLETED_MATCH, sevenDaysAgo)).toEqual([
      { $match: { ...COMPLETED_MATCH, purchasedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$purchasedAt" } },
          revenue: { $sum: { $toDouble: "$amount" } },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  });

  it("buildTopMaterialsPipeline groups by materialId, sorts by sales desc and limits to 10", () => {
    expect(buildTopMaterialsPipeline(COMPLETED_MATCH)).toEqual([
      { $match: COMPLETED_MATCH },
      {
        $group: {
          _id: "$materialId",
          sales: { $sum: 1 },
          revenue: { $sum: { $toDouble: "$amount" } },
        },
      },
      { $sort: { sales: -1 } },
      { $limit: 10 },
    ]);
  });

  it("buildTopMaterialsPipeline supports a custom limit", () => {
    const pipeline = buildTopMaterialsPipeline(COMPLETED_MATCH, 3);
    expect(pipeline.at(-1)).toEqual({ $limit: 3 });
    expect(pipeline).toHaveLength(4);
  });

  it("buildPurchasesRefundsPipeline matches refunded purchases and sums the amount", () => {
    expect(buildPurchasesRefundsPipeline(MATERIAL_IDS)).toEqual([
      {
        $match: {
          materialId: { $in: MATERIAL_IDS },
          $or: [{ status: "refunded" }, { settlementState: "Refunded" }],
        },
      },
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } },
    ]);
  });
});

describe("response shapers", () => {
  it("resolveMaterialIdStrings dedupes _id and materialId across materials", () => {
    const ids = resolveMaterialIdStrings([
      { _id: "a", materialId: "a-id" },
      { _id: "b" },
      { _id: "a", materialId: "a-id" },
    ]);
    expect(ids.sort()).toEqual(["a", "a-id", "b"]);
  });

  it("buildMaterialTitleMap maps every key to the title, defaulting to Untitled", () => {
    const map = buildMaterialTitleMap([
      { _id: "a", materialId: "a-id", title: "Notes" },
      { _id: "b" },
    ]);
    expect(map.get("a")).toBe("Notes");
    expect(map.get("a-id")).toBe("Notes");
    expect(map.get("b")).toBe("Untitled material");
  });

  it("countSavesByMaterial counts saves per stringified materialId", () => {
    const counts = countSavesByMaterial([
      { materialId: "a" },
      { materialId: "a" },
      { materialId: "b" },
      { materialId: 123 },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("123")).toBe(1);
  });

  it("buildTopMaterials ranks by completedOrders then learnerInterest then activity", () => {
    const creatorMaterials = [
      {
        _id: "a",
        title: "Alpha",
        visibility: "public",
        createdAt: new Date("2026-11-01"),
        views: 10,
        downloads: 5,
      },
      {
        _id: "b",
        title: "Beta",
        visibility: "private",
        createdAt: new Date("2026-11-02"),
        viewCount: 3,
        downloadCount: 2,
        reviewCount: 1,
      },
    ];
    const topMaterialsAgg = [
      { _id: "a", sales: 4, revenue: 12.5 },
      { _id: "b", sales: 1, revenue: 3 },
    ];
    const saveCounts = new Map([["a", 2]]);

    const result = buildTopMaterials(creatorMaterials, topMaterialsAgg, saveCounts);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "a",
      name: "Alpha",
      sales: 4,
      completedOrders: 4,
      learnerInterest: 2,
      activity: 15,
      revenue: "$12.50",
      visibility: "public",
    });
    expect(result[1]).toMatchObject({
      id: "b",
      name: "Beta",
      sales: 1,
      completedOrders: 1,
      learnerInterest: 0,
      activity: 6,
      revenue: "$3.00",
      visibility: "private",
    });
  });

  it("buildTopMaterials caps at 5 entries", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      _id: `m${i}`,
      title: `M${i}`,
      visibility: "public",
      createdAt: new Date(),
      views: 0,
    }));
    const agg = many.map((m) => ({ _id: m._id, sales: 1, revenue: 1 }));
    expect(buildTopMaterials(many, agg, new Map())).toHaveLength(5);
  });

  it("buildChartData maps purchase buckets, uploads and saves into a 7-day window", () => {
    const sevenDaysAgo = startOfSevenDayWindow(new Date("2026-11-21T12:00:00"));
    const firstDayKey = new Date(sevenDaysAgo).toISOString().slice(0, 10);
    const chartAgg = [{ _id: firstDayKey, revenue: 5, orders: 1 }];
    const creatorMaterials = [{ createdAt: new Date(sevenDaysAgo) }];
    const savedDocs = [{ savedAt: new Date(sevenDaysAgo), materialId: "x" }];

    const chart = buildChartData({ chartAgg, creatorMaterials, savedDocs, sevenDaysAgo });
    expect(chart).toHaveLength(7);
    expect(chart[0]).toMatchObject({ revenue: 5, orders: 1, uploads: 1, interest: 1 });
    expect(chart[1]).toMatchObject({ revenue: 0, orders: 0, uploads: 0, interest: 0 });
    expect(chart.every((c) => DAY_LABELS.includes(c.day))).toBe(true);
  });

  it("buildRecentOrders maps docs using the title map and a composite id fallback", () => {
    const titleMap = new Map([["m1", "Calculus Notes"]]);
    const orders = [
      {
        _id: "ord1",
        materialId: "m1",
        buyerAddress: "0xbuyer",
        amount: 12.5,
        status: "completed",
        purchasedAt: "2026-11-20",
      },
      { materialId: "m2", buyerAddress: "0xbuyer2", amount: 0 },
    ];
    const result = buildRecentOrders(orders, titleMap);
    expect(result[0]).toMatchObject({
      id: "ord1",
      material: "Calculus Notes",
      buyer: "0xbuyer",
      amount: "$12.50",
      status: "completed",
    });
    expect(typeof result[0].date).toBe("string");
    expect(result[1].id).toBe("m2-0xbuyer2");
    expect(result[1].material).toBe("Unknown material");
  });

  it("buildEmptyAnalytics returns zeroed analytics with a 7-day chart and the range", () => {
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-30T00:00:00Z");
    const result = buildEmptyAnalytics(from, to);
    expect(result).toMatchObject({
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
      topMaterials: [],
      recentOrders: [],
      withdrawals: [],
    });
    expect(result.chartData).toHaveLength(7);
    expect(result.dateRange).toEqual({ from: from.toISOString(), to: to.toISOString() });
  });
});
