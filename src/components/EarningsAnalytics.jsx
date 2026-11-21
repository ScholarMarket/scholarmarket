"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import useEarningsData from "../hooks/useEarningsData";
import "./EarningsAnalytics.css";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 7 });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 7 });

export default function EarningsAnalytics() {
  const [selected, setSelected] = useState("7d");
  const [chartReady, setChartReady] = useState(false);
  const { data, isLoading, error } = useEarningsData(selected);
  const points = data?.chartData || [];
  return (
    <section className="earnings-analytics" aria-label="Earnings analytics">
      <Script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
        strategy="lazyOnload" onReady={() => setChartReady(true)} />
      <div className="interval-selector" role="group" aria-label="Time interval">
        {[{ label: "7 Days", value: "7d" }, { label: "30 Days", value: "30d" }, { label: "Year-to-Date", value: "ytd" }].map(interval => (
          <button key={interval.value} className={`interval-btn ${selected === interval.value ? "active" : ""}`}
            onClick={() => setSelected(interval.value)} aria-pressed={selected === interval.value}>
            {interval.label}
          </button>
        ))}
      </div>
      {isLoading ? <p role="status">Loading earnings...</p>
        : error ? <p role="alert">{error}</p>
          : <>
            <dl>
              <dt>Total revenue</dt><dd>{currency.format(data?.totalRevenue ?? 0)}</dd>
              <dt>Total sales</dt><dd>{number.format(data?.totalSales ?? 0)}</dd>
            </dl>
            {points.some(point => Number(point.revenue) !== 0 || Number(point.orders) !== 0)
              ? <Chart data={points} ready={chartReady} />
              : <p role="status">No earnings for this period.</p>}
          </>}
    </section>
  );
}

function Chart({ data, ready }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!ready || !window.Chart) return;
    const chart = new window.Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: data.map(point => point.day),
        datasets: [{ label: "Revenue", data: data.map(point => point.revenue), borderColor: "#4caf50", tension: 0.3 }],
      },
      options: {
        responsive: true,
        plugins: { tooltip: { callbacks: { label: context => currency.format(context.parsed.y) } } },
        scales: { y: { title: { display: true, text: "Amount (USD)" } } },
      },
    });
    return () => chart.destroy();
  }, [data, ready]);
  return <canvas ref={canvasRef} className="earnings-canvas" role="img" aria-label="Revenue by day" />;
}
