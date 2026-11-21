import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { earningsFixture } from "../../../test/fixtures/earnings";
vi.mock("next/script", () => ({ default: function Script({ onReady }) {
  React.useEffect(() => { onReady(); }, [onReady]);
  return null;
} }));
import EarningsAnalytics from "../EarningsAnalytics";
const requests = [];
const server = setupServer(http.get("*/api/creator/analytics", ({ request }) => {
  requests.push(new URL(request.url));
  return HttpResponse.json(earningsFixture);
}));
let destroy;
let chart;
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  requests.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T12:34:56Z"));
  destroy = vi.fn();
  chart = vi.fn(function () { this.destroy = destroy; });
  vi.stubGlobal("Chart", chart);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({});
});
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => server.close());
describe("EarningsAnalytics", () => {
  it("shows loading, fixture totals and seven-decimal currency with grouped numbers", async () => {
    server.use(http.get("*/api/creator/analytics", async () => { await delay(30); return HttpResponse.json(earningsFixture); }));
    render(<EarningsAnalytics />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading earnings");
    expect(await screen.findByText("$1,234.1234567")).toBeVisible();
    expect(screen.getByText("12,345")).toBeVisible();
    expect(earningsFixture.chartData.reduce((total, point) => total + point.revenue, 0)).toBe(earningsFixture.totalRevenue);
    expect(earningsFixture.chartData.reduce((total, point) => total + point.orders, 0)).toBe(earningsFixture.totalSales);
    expect(screen.getByRole("img", { name: "Revenue by day" })).toBeVisible();
    await waitFor(() => expect(chart).toHaveBeenCalled());
    const config = chart.mock.calls.at(-1)[1];
    expect(config.data.labels).toEqual(["Mon", "Tue"]);
    expect(config.data.datasets[0].data).toEqual([1200, 34.1234567]);
    expect(config.options.plugins.tooltip.callbacks.label({ parsed: { y: 0.0000001 } })).toBe("$0.0000001");
  });
  it("requests new date ranges and updates the selected button", async () => {
    render(<EarningsAnalytics />);
    await screen.findByText("$1,234.1234567");
    fireEvent.click(screen.getByRole("button", { name: "30 Days" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].searchParams.get("from")).toBe("2026-10-23T00:00:00.000Z");
    expect(screen.getByRole("button", { name: "30 Days" })).toHaveAttribute("aria-pressed", "true");
    await screen.findByText("$1,234.1234567");
    fireEvent.click(screen.getByRole("button", { name: "Year-to-Date" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].searchParams.get("from")).toBe("2026-01-01T00:00:00.000Z");
  });
  it.each([{ totalRevenue: 0, totalSales: 0, chartData: [] }, { chartData: [{ day: "Mon", revenue: 0, orders: 0 }] }, {}])("renders empty states with zero totals: %j", async fixture => {
    server.use(http.get("*/api/creator/analytics", () => HttpResponse.json(fixture)));
    render(<EarningsAnalytics />);
    expect(await screen.findByText("No earnings for this period.")).toBeVisible();
    expect(screen.getByText("$0.00")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(chart).not.toHaveBeenCalled();
  });
  it("shows an error without displaying stale revenue", async () => {
    server.use(http.get("*/api/creator/analytics", () => new HttpResponse(null, { status: 500 })));
    render(<EarningsAnalytics />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load earnings");
    expect(screen.queryByText("Total revenue")).toBeNull();
  });
  it("destroys the chart when unmounted", async () => {
    const { unmount } = render(<EarningsAnalytics />);
    await waitFor(() => expect(chart).toHaveBeenCalled());
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
  it("renders analytics even when the chart library is unavailable", async () => {
    vi.stubGlobal("Chart", undefined);
    render(<EarningsAnalytics />);
    expect(await screen.findByText("$1,234.1234567")).toBeVisible();
  });
});
