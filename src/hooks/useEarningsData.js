import { useEffect, useState } from "react";

/** Fetch creator analytics for an inclusive UTC calendar range. */
export default function useEarningsData(interval) {
  const [state, setState] = useState({ data: null, isLoading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    if (interval === "ytd") from.setUTCMonth(0, 1);
    else from.setUTCDate(from.getUTCDate() - (interval === "30d" ? 29 : 6));
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    setState({ data: null, isLoading: true, error: null });
    async function load() {
      try {
        const response = await fetch(new URL(`/api/creator/analytics?${params}`, window.location.origin), { signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load earnings");
        const data = await response.json();
        if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState({ data: null, isLoading: false, error: error.message });
      }
    }
    load();
    return () => controller.abort();
  }, [interval]);
  return state;
}
