import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import useEarningsData from "../useEarningsData";
import { earningsFixture } from "../../../test/fixtures/earnings";
const requests = [];
const server = setupServer(http.get("*/api/creator/analytics", ({ request }) => {
  requests.push(new URL(request.url));
  return HttpResponse.json(earningsFixture);
}));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  requests.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T12:34:56.000Z"));
});
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); });
afterAll(() => server.close());
describe("useEarningsData", () => {
  it("fetches and preserves exact seven-decimal fixture values", async () => {
    const { result } = renderHook(() => useEarningsData("7d"));
    expect(result.current).toEqual({ data: null, isLoading: true, error: null });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(earningsFixture);
    expect(result.current.error).toBeNull();
    expect(requests[0].searchParams.get("from")).toBe("2026-11-15T00:00:00.000Z");
    expect(requests[0].searchParams.get("to")).toBe("2026-11-21T12:34:56.000Z");
  });
  it("switches ranges and sends UTC 30-day and year-to-date parameters", async () => {
    const { result, rerender } = renderHook(({ interval }) => useEarningsData(interval), { initialProps: { interval: "7d" } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ interval: "30d" });
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(requests[1].searchParams.get("from")).toBe("2026-10-23T00:00:00.000Z");
    rerender({ interval: "ytd" });
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].searchParams.get("from")).toBe("2026-01-01T00:00:00.000Z");
  });
  it("returns empty analytics without inventing earnings", async () => {
    server.use(http.get("*/api/creator/analytics", () => HttpResponse.json({ totalRevenue: 0, totalSales: 0, chartData: [] })));
    const { result } = renderHook(() => useEarningsData("7d"));
    await waitFor(() => expect(result.current.data?.chartData).toEqual([]));
  });
  it.each(["http", "network"])("exposes %s errors", async kind => {
    server.use(http.get("*/api/creator/analytics", () => kind === "http" ? new HttpResponse(null, { status: 500 }) : HttpResponse.error()));
    const { result } = renderHook(() => useEarningsData("7d"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });
  it("aborts an old range and ignores its late response", async () => {
    let firstSignal;
    server.use(http.get("*/api/creator/analytics", async ({ request }) => {
      if (new URL(request.url).searchParams.get("from").startsWith("2026-11-15")) {
        firstSignal = request.signal;
        await delay(80);
        return HttpResponse.json({ totalRevenue: 999 });
      }
      return HttpResponse.json(earningsFixture);
    }));
    const { result, rerender, unmount } = renderHook(({ interval }) => useEarningsData(interval), { initialProps: { interval: "7d" } });
    await waitFor(() => expect(firstSignal).toBeDefined());
    rerender({ interval: "30d" });
    await waitFor(() => expect(result.current.data).toEqual(earningsFixture));
    expect(firstSignal.aborted).toBe(true);
    unmount();
  });
});
