import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/hooks/__tests__/useEarningsData.test.jsx", "src/components/__tests__/EarningsAnalytics.test.jsx"],
    coverage: {
      ...base.test.coverage,
      include: ["src/hooks/useEarningsData.js", "src/components/EarningsAnalytics.jsx"],
      thresholds: { perFile: true, lines: 85 },
    },
  },
});
