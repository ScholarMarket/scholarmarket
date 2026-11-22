/**
 * Tax Estimator — hardened edition (issue #173)
 *
 * All intermediate arithmetic uses BigInt stroops (1 XLM = 10 000 000 stroops)
 * so floating-point drift is impossible.  Half-up rounding is applied once, at
 * the final step when converting the tax back to a 7-decimal XLM string.
 *
 * Public API (backward-compatible with pre-#173 callers):
 *   estimateTax({ ipAddress?, baseAmount, countryCode?, buyerType? })
 *   applyTaxToCheckout(checkoutIntent)
 *   calculateTaxAmount(baseAmount, taxRateBps)
 *   getTaxRateForCountry(countryCode)              ← thin alias over getTaxRateBps
 *   isValidTaxRate(taxRateBps)
 *   resolveGeolocation(ipAddress)
 *
 * New named exports (tree-shakeable):
 *   parseToStroops(value)                          ← converts XLM number → bigint stroops
 *   stroopsToXlm(stroops)                          ← converts bigint stroops → number (7dp)
 *   halfUpRound(numerator, denominator)            ← bigint half-up division
 */

import {
  MAX_TAX_RATE_BPS,
  getTaxRateBps,
  isTaxExempt,
  DEFAULT_REGION_CODE,
  TAX_RATES,
} from '../config/taxRates.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const STROOPS_PER_XLM = 10_000_000n;
const BPS_DENOMINATOR = 10_000n;

// ─── Low-level bigint helpers ─────────────────────────────────────────────────

/**
 * Convert a non-negative XLM amount (number, up to 7 decimal places) into an
 * exact bigint stroop count.
 *
 * Rejects strings — callers must parse their own input before passing it here
 * so type confusion cannot silently produce wrong amounts.
 *
 * @param {number} value  Non-negative finite number
 * @returns {bigint}
 * @throws {Error} When value is not a finite non-negative number
 */
export function parseToStroops(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid amount: expected a non-negative finite number, got ${JSON.stringify(value)}.`,
    );
  }
  // Represent with exactly 7 decimal places to avoid floating-point ambiguity,
  // then remove the decimal point to get the integer stroop count.
  const fixed = value.toFixed(7);           // e.g. "12.3456789"
  const [whole, frac] = fixed.split('.');   // ["12", "3456789"]
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(frac ?? '0000000');
}

/**
 * Convert a non-negative bigint stroop count back to a 7-decimal XLM number.
 * Precision is preserved exactly; there is no additional rounding here.
 *
 * @param {bigint} stroops
 * @returns {number}
 */
export function stroopsToXlm(stroops) {
  const whole = stroops / STROOPS_PER_XLM;
  const frac  = stroops % STROOPS_PER_XLM;
  // Pad fraction to 7 digits and re-join as a decimal string before parsing.
  return Number(`${whole}.${String(frac).padStart(7, '0')}`);
}

/**
 * Half-up rounding for bigint division: ⌊ numerator / denominator + 0.5 ⌋
 *
 * "Half-up" (also called "round half away from zero" for positive values) is
 * the convention most familiar to users and is mandated by many financial
 * regulations for sales tax.  It is deterministic — unlike banker's rounding
 * it does not depend on the parity of the neighbouring integer — which makes
 * unit-testing straightforward.
 *
 * Example: halfUpRound(5n, 2n) → 3n  (2.5 rounds up to 3)
 *          halfUpRound(4n, 2n) → 2n  (2.0 is exact)
 *
 * @param {bigint} numerator    – dividend (non-negative)
 * @param {bigint} denominator  – divisor (positive)
 * @returns {bigint}
 */
export function halfUpRound(numerator, denominator) {
  // Add half a denominator before integer-dividing so the midpoint rounds up.
  return (numerator + denominator / 2n) / denominator;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Returns true when taxRateBps is a non-negative integer within the ceiling.
 * @param {number} taxRateBps
 * @returns {boolean}
 */
export function isValidTaxRate(taxRateBps) {
  return (
    Number.isFinite(taxRateBps) &&
    Number.isInteger(taxRateBps) &&
    taxRateBps >= 0 &&
    taxRateBps <= MAX_TAX_RATE_BPS
  );
}

// ─── Region / rate helpers ────────────────────────────────────────────────────

/**
 * Backward-compatible alias used by pre-#173 tests and callers.
 * Delegates to the config-driven getTaxRateBps.
 * @param {string} countryCode
 * @returns {number} bps
 */
export function getTaxRateForCountry(countryCode) {
  return getTaxRateBps(countryCode);
}

/**
 * Thin re-export so the entire region map is accessible without importing the
 * config file directly (useful for admin tooling / diagnostics).
 */
export { TAX_RATES as DEFAULT_TAX_RATES };

// ─── Core calculation ─────────────────────────────────────────────────────────

/**
 * Calculate the tax amount for a given base amount and rate.
 *
 * All arithmetic is performed in integer stroops (BigInt).  The result is
 * converted back to a 7-decimal XLM number at the end, with one half-up
 * rounding step — rounding only happens once, at the boundary between the
 * integer world and the floating-point world.
 *
 * Formula (stroop domain):
 *   taxStroops = halfUpRound( netStroops × rateBps, 10 000 )
 *
 * @param {number} baseAmount   Non-negative XLM amount (up to 7 dp)
 * @param {number} taxRateBps   Rate in basis points; must pass isValidTaxRate()
 * @returns {number}            Tax amount in XLM, 7 decimal precision
 * @throws {Error}              On invalid input
 */
export function calculateTaxAmount(baseAmount, taxRateBps) {
  if (!isValidTaxRate(taxRateBps)) {
    throw new Error(
      `Invalid tax rate: ${taxRateBps}. Must be an integer in [0, ${MAX_TAX_RATE_BPS}].`,
    );
  }
  const netStroops = parseToStroops(baseAmount);
  const taxStroops = halfUpRound(netStroops * BigInt(taxRateBps), BPS_DENOMINATOR);
  return stroopsToXlm(taxStroops);
}

// ─── Geolocation ──────────────────────────────────────────────────────────────

/**
 * Resolve a rough country code from an IPv4/IPv6 address.
 *
 * Uses ip-api.com (free tier, non-HTTPS).  For production deployments replace
 * with a paid provider (MaxMind GeoIP2, ipinfo.io, etc.) by overriding the
 * NEXT_PUBLIC_GEO_API_URL environment variable.
 *
 * Returns `{ countryCode: 'DEFAULT' }` on any network or parse error so the
 * caller always receives a usable fallback.
 *
 * @param {string} ipAddress
 * @returns {Promise<{ countryCode: string, countryName: string, region: string|null, city: string|null }>}
 */
export async function resolveGeolocation(ipAddress) {
  try {
    const base = process.env.NEXT_PUBLIC_GEO_API_URL ?? 'http://ip-api.com/json';
    const response = await fetch(`${base}/${encodeURIComponent(ipAddress)}`);

    if (!response.ok) {
      console.warn('[taxEstimator] Geolocation API request failed:', response.status);
      return { countryCode: DEFAULT_REGION_CODE, countryName: 'Unknown', region: null, city: null };
    }

    const data = await response.json();
    return {
      countryCode: data.countryCode || DEFAULT_REGION_CODE,
      countryName: data.country   || 'Unknown',
      region:      data.regionName || null,
      city:        data.city       || null,
    };
  } catch (error) {
    console.error('[taxEstimator] Error resolving geolocation:', error);
    return { countryCode: DEFAULT_REGION_CODE, countryName: 'Unknown', region: null, city: null };
  }
}

// ─── estimateTax ──────────────────────────────────────────────────────────────

/**
 * Full tax estimation for a checkout transaction.
 *
 * Returns a line-item breakdown so the UI can display each component:
 *   net    – the base amount the buyer owes before tax
 *   tax    – the calculated tax (0 when exempt or rate is 0)
 *   total  – net + tax
 *
 * Tax-exempt buyers (universities, government bodies, registered charities,
 * etc.) are identified via the `buyerType` field.  When exempt, the response
 * includes `exempt: true` and a zero tax amount regardless of region rate.
 *
 * @param {object}  params
 * @param {number}  params.baseAmount   – pre-tax XLM amount
 * @param {string}  [params.countryCode] – ISO 3166-1 alpha-2; resolved from IP if absent
 * @param {string}  [params.ipAddress]  – used for geolocation when countryCode is absent
 * @param {string}  [params.buyerType]  – institutional type for exemption check
 *
 * @returns {Promise<{
 *   net:            number,
 *   tax:            number,
 *   total:          number,
 *   taxRateBps:     number,
 *   taxRatePercent: string,
 *   exempt:         boolean,
 *   geolocation:    object,
 *   breakdown: {
 *     netStroops:   string,
 *     taxStroops:   string,
 *     totalStroops: string,
 *     roundingRule: string,
 *   },
 *   // Backward-compat aliases kept for pre-#173 callers:
 *   baseAmount:  number,
 *   taxAmount:   number,
 *   totalAmount: number,
 * }>}
 */
export async function estimateTax({ ipAddress, baseAmount, countryCode, buyerType } = {}) {
  // Validate amount first so errors surface before any network call.
  const netStroops = parseToStroops(baseAmount);

  // Resolve geolocation.
  let geoData;
  if (countryCode) {
    geoData = { countryCode, countryName: 'Provided', region: null, city: null };
  } else if (ipAddress) {
    geoData = await resolveGeolocation(ipAddress);
  } else {
    geoData = { countryCode: DEFAULT_REGION_CODE, countryName: 'Unknown', region: null, city: null };
  }

  // Tax-exempt buyers: short-circuit with a zero-tax result.
  const exempt = isTaxExempt(buyerType);
  if (exempt) {
    const net   = stroopsToXlm(netStroops);
    const zeros = '0'.padEnd(7, '0');
    return {
      net,
      tax:            0,
      total:          net,
      taxRateBps:     0,
      taxRatePercent: '0.00',
      exempt:         true,
      geolocation:    geoData,
      breakdown: {
        netStroops:   String(netStroops),
        taxStroops:   '0',
        totalStroops: String(netStroops),
        roundingRule: 'exempt — no rounding applied',
      },
      // Backward-compat aliases.
      baseAmount:  net,
      taxAmount:   0,
      totalAmount: net,
    };
  }

  const taxRateBps = getTaxRateBps(geoData.countryCode);
  const taxStroops = halfUpRound(netStroops * BigInt(taxRateBps), BPS_DENOMINATOR);
  const totalStroops = netStroops + taxStroops;

  const net   = stroopsToXlm(netStroops);
  const tax   = stroopsToXlm(taxStroops);
  const total = stroopsToXlm(totalStroops);

  return {
    net,
    tax,
    total,
    taxRateBps,
    taxRatePercent: (taxRateBps / 100).toFixed(2),
    exempt:         false,
    geolocation:    geoData,
    breakdown: {
      netStroops:   String(netStroops),
      taxStroops:   String(taxStroops),
      totalStroops: String(totalStroops),
      roundingRule: 'half-up: taxStroops = floor((netStroops × rateBps + 5000) / 10000)',
    },
    // Backward-compat aliases so pre-#173 callers that destructure
    // { baseAmount, taxAmount, totalAmount } continue to work unchanged.
    baseAmount:  net,
    taxAmount:   tax,
    totalAmount: total,
  };
}

// ─── applyTaxToCheckout ───────────────────────────────────────────────────────

/**
 * Apply tax to a checkout intent object and return an enriched copy.
 *
 * Preserves all existing fields and adds:
 *   originalAmount, taxAmount, taxRateBps, totalAmount, geolocation,
 *   net, tax, total, taxRatePercent, exempt, breakdown
 *
 * Throws for invalid/missing amounts so the checkout route can return a 400
 * rather than silently recording a wrong total.
 *
 * @param {object} checkoutIntent
 * @param {number} checkoutIntent.amount
 * @param {string} [checkoutIntent.buyerIp]
 * @param {string} [checkoutIntent.buyerCountry]
 * @param {string} [checkoutIntent.buyerType]
 * @returns {Promise<object>}
 */
export async function applyTaxToCheckout(checkoutIntent) {
  const { amount, buyerIp, buyerCountry, buyerType } = checkoutIntent ?? {};

  if (amount === undefined || amount === null) {
    throw new Error('Invalid amount for tax calculation');
  }
  // This call will throw with a descriptive message on bad input.
  parseToStroops(amount);

  const result = await estimateTax({
    ipAddress:   buyerIp,
    baseAmount:  amount,
    countryCode: buyerCountry,
    buyerType,
  });

  return {
    ...checkoutIntent,
    originalAmount:  amount,
    // Backward-compat fields (consumed by checkout/initiate/route.js):
    taxAmount:       result.taxAmount,
    taxRateBps:      result.taxRateBps,
    totalAmount:     result.totalAmount,
    geolocation:     result.geolocation,
    // New line-item fields:
    net:             result.net,
    tax:             result.tax,
    total:           result.total,
    taxRatePercent:  result.taxRatePercent,
    exempt:          result.exempt,
    breakdown:       result.breakdown,
  };
}
