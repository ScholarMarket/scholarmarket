/**
 * Region tax-rate configuration.
 *
 * Rates are stored in basis points (bps) where 10 000 bps = 100 %.
 * All entries use ISO 3166-1 alpha-2 country codes as keys.
 *
 * Adding a new region
 * ───────────────────
 * 1. Add a key to TAX_RATES with the country code and bps rate.
 * 2. If the jurisdiction levies a different rate on digital goods/services,
 *    add a "digital" sub-key (future extension; not consumed yet).
 * 3. Update EXEMPT_BUYER_TYPES if that region has specific institutional
 *    exemption categories.
 *
 * Sources (retrieved 2026-11; always verify before a production rate change):
 *   EU VAT rates   – https://taxation-customs.ec.europa.eu/vat-rates_en
 *   US sales tax   – state average; individual state rules not modelled here
 *   Others         – local tax authority publications
 *
 * MAX_TAX_RATE_BPS caps the highest rate accepted by isValidTaxRate().
 * It is intentionally set above the highest known rate (HU 27 %) to leave
 * headroom, while still blocking clearly erroneous values.
 */

export const MAX_TAX_RATE_BPS = 3500; // 35 % hard ceiling

/**
 * Default fallback rate for unknown regions: 0 bps (no tax applied).
 * Operators should override via the env variable NEXT_PUBLIC_DEFAULT_TAX_BPS
 * if their jurisdiction requires a catch-all rate.
 */
export const DEFAULT_REGION_CODE = 'DEFAULT';

export const TAX_RATES = {
  // Americas
  US:  Number(process.env.NEXT_PUBLIC_TAX_BPS_US  ?? 800),   // 8 % average sales tax
  CA:  Number(process.env.NEXT_PUBLIC_TAX_BPS_CA  ?? 500),   // 5 % federal GST
  MX:  Number(process.env.NEXT_PUBLIC_TAX_BPS_MX  ?? 1600),  // 16 % IVA
  BR:  Number(process.env.NEXT_PUBLIC_TAX_BPS_BR  ?? 1700),  // 17 % avg ICMS

  // Europe
  GB:  Number(process.env.NEXT_PUBLIC_TAX_BPS_GB  ?? 2000),  // 20 % VAT
  DE:  Number(process.env.NEXT_PUBLIC_TAX_BPS_DE  ?? 1900),  // 19 % VAT
  FR:  Number(process.env.NEXT_PUBLIC_TAX_BPS_FR  ?? 2000),  // 20 % VAT
  IT:  Number(process.env.NEXT_PUBLIC_TAX_BPS_IT  ?? 2200),  // 22 % VAT
  ES:  Number(process.env.NEXT_PUBLIC_TAX_BPS_ES  ?? 2100),  // 21 % VAT
  NL:  Number(process.env.NEXT_PUBLIC_TAX_BPS_NL  ?? 2100),  // 21 % VAT
  BE:  Number(process.env.NEXT_PUBLIC_TAX_BPS_BE  ?? 2100),  // 21 % VAT
  AT:  Number(process.env.NEXT_PUBLIC_TAX_BPS_AT  ?? 2000),  // 20 % VAT
  CH:  Number(process.env.NEXT_PUBLIC_TAX_BPS_CH  ?? 810),   // 8.1 % VAT (2024+)
  SE:  Number(process.env.NEXT_PUBLIC_TAX_BPS_SE  ?? 2500),  // 25 % VAT
  NO:  Number(process.env.NEXT_PUBLIC_TAX_BPS_NO  ?? 2500),  // 25 % VAT
  DK:  Number(process.env.NEXT_PUBLIC_TAX_BPS_DK  ?? 2500),  // 25 % VAT
  PL:  Number(process.env.NEXT_PUBLIC_TAX_BPS_PL  ?? 2300),  // 23 % VAT
  CZ:  Number(process.env.NEXT_PUBLIC_TAX_BPS_CZ  ?? 2100),  // 21 % VAT
  HU:  Number(process.env.NEXT_PUBLIC_TAX_BPS_HU  ?? 2700),  // 27 % VAT
  RO:  Number(process.env.NEXT_PUBLIC_TAX_BPS_RO  ?? 1900),  // 19 % VAT
  BG:  Number(process.env.NEXT_PUBLIC_TAX_BPS_BG  ?? 2000),  // 20 % VAT
  GR:  Number(process.env.NEXT_PUBLIC_TAX_BPS_GR  ?? 2400),  // 24 % VAT
  PT:  Number(process.env.NEXT_PUBLIC_TAX_BPS_PT  ?? 2300),  // 23 % VAT
  FI:  Number(process.env.NEXT_PUBLIC_TAX_BPS_FI  ?? 2400),  // 24 % VAT
  IE:  Number(process.env.NEXT_PUBLIC_TAX_BPS_IE  ?? 2300),  // 23 % VAT
  LU:  Number(process.env.NEXT_PUBLIC_TAX_BPS_LU  ?? 1700),  // 17 % VAT
  SK:  Number(process.env.NEXT_PUBLIC_TAX_BPS_SK  ?? 2000),  // 20 % VAT
  SI:  Number(process.env.NEXT_PUBLIC_TAX_BPS_SI  ?? 2200),  // 22 % VAT
  EE:  Number(process.env.NEXT_PUBLIC_TAX_BPS_EE  ?? 2200),  // 22 % VAT (2024+)
  LV:  Number(process.env.NEXT_PUBLIC_TAX_BPS_LV  ?? 2100),  // 21 % VAT
  LT:  Number(process.env.NEXT_PUBLIC_TAX_BPS_LT  ?? 2100),  // 21 % VAT
  CY:  Number(process.env.NEXT_PUBLIC_TAX_BPS_CY  ?? 1900),  // 19 % VAT
  MT:  Number(process.env.NEXT_PUBLIC_TAX_BPS_MT  ?? 1800),  // 18 % VAT

  // Asia-Pacific
  AU:  Number(process.env.NEXT_PUBLIC_TAX_BPS_AU  ?? 1000),  // 10 % GST
  JP:  Number(process.env.NEXT_PUBLIC_TAX_BPS_JP  ?? 1000),  // 10 % consumption tax
  IN:  Number(process.env.NEXT_PUBLIC_TAX_BPS_IN  ?? 1800),  // 18 % GST

  // Catch-all — 0 % unless overridden via env
  [DEFAULT_REGION_CODE]: Number(process.env.NEXT_PUBLIC_DEFAULT_TAX_BPS ?? 0),
};

/**
 * Buyer types that are unconditionally exempt from tax in all regions.
 * Extend this list when new institutional categories are onboarded.
 *
 * The checkout API forwards `buyerType` from the authenticated user profile.
 * Any value present here causes `estimateTax` to return a 0-rate result with
 * `exempt: true` in the response, regardless of the region's configured rate.
 *
 * Values are matched case-insensitively.
 */
export const EXEMPT_BUYER_TYPES = [
  'university',
  'school',
  'nonprofit',
  'government',
  'charity',
  'research_institution',
];

/**
 * Returns true when the given buyer type qualifies for a tax exemption.
 * @param {string|undefined} buyerType
 */
export function isTaxExempt(buyerType) {
  if (!buyerType) return false;
  const normalized = String(buyerType).toLowerCase().trim();
  return EXEMPT_BUYER_TYPES.some((t) => t === normalized);
}

/**
 * Look up the configured rate for an ISO country code.
 * Unknown codes fall back to DEFAULT (0 bps unless env overrides it).
 * @param {string} countryCode
 * @returns {number} bps
 */
export function getTaxRateBps(countryCode) {
  const key = String(countryCode ?? '').toUpperCase().trim() || DEFAULT_REGION_CODE;
  const rate = TAX_RATES[key] ?? TAX_RATES[DEFAULT_REGION_CODE] ?? 0;
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}
