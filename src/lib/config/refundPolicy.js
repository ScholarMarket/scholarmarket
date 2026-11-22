/**
 * Refund policy configuration (issue #170).
 *
 * All values can be overridden via environment variables so deployments can
 * tighten or relax the policy without a code change.  Defaults are
 * intentionally conservative: 7-day window, max 2 downloads before the right
 * to refund is forfeited.
 *
 * Adding a new reason code
 * ────────────────────────
 * 1. Add a key to REFUND_REASON_CODES.
 * 2. Add a corresponding entry to PARTIAL_REFUND_SCHEDULE with the fraction
 *    of the purchase price to return (0–1).  A fraction of 1 means a full
 *    refund; 0 means no money is returned (the request is effectively denied
 *    at the amount level even if policy allows it).
 * 3. Update the docs / CONTRIBUTING.md if the new code is user-facing.
 */

/** Maximum days after purchase during which a refund request is accepted. */
export const REFUND_WINDOW_DAYS = Number(
  process.env.REFUND_WINDOW_DAYS ?? 7,
);

/**
 * Maximum number of times a buyer may download (access) the content before
 * losing the right to request a refund.  Set to 0 to disable this check.
 */
export const REFUND_MAX_DOWNLOADS = Number(
  process.env.REFUND_MAX_DOWNLOADS ?? 2,
);

/**
 * Minimum fraction of the original purchase price that must be returned on
 * any approved refund request (0–1).  Guards against admin misconfiguration
 * of the partial schedule.
 */
export const REFUND_MIN_FRACTION = Number(
  process.env.REFUND_MIN_FRACTION ?? 0,
);

/**
 * Typed reason codes.  Routes and service layers should import these instead
 * of using raw strings so a rename is a single change here.
 *
 * FULL codes guarantee a 100 % refund.
 * PARTIAL codes apply the fraction in PARTIAL_REFUND_SCHEDULE.
 * DENIED codes block the request with a clear reason.
 */
export const REFUND_REASON_CODES = Object.freeze({
  // Buyer-initiated reasons
  NOT_AS_DESCRIBED:    'not_as_described',
  TECHNICAL_ISSUE:     'technical_issue',
  DUPLICATE_PURCHASE:  'duplicate_purchase',
  ACCIDENTAL_PURCHASE: 'accidental_purchase',

  // Policy-level denial reasons (returned from checkRefundPolicy)
  WINDOW_EXPIRED:      'window_expired',
  DOWNLOAD_LIMIT:      'download_limit_exceeded',
  ALREADY_REFUNDED:    'already_refunded',
  WRONG_STATUS:        'wrong_purchase_status',
});

/**
 * Maps each buyer-initiated reason code to the fraction of the original
 * purchase price to return (0–1, inclusive).
 *
 * Partial amounts are rounded to 7 decimal places (Stellar precision) by
 * calculateRefundAmount() in refundVerifier.js.
 */
export const PARTIAL_REFUND_SCHEDULE = Object.freeze({
  [REFUND_REASON_CODES.NOT_AS_DESCRIBED]:    1.0,  // full refund
  [REFUND_REASON_CODES.TECHNICAL_ISSUE]:     1.0,  // full refund
  [REFUND_REASON_CODES.DUPLICATE_PURCHASE]:  1.0,  // full refund
  [REFUND_REASON_CODES.ACCIDENTAL_PURCHASE]: 0.5,  // 50 % — buyer already had access
});

/**
 * Returns the refund fraction for a given reason code, falling back to 1.0
 * (full refund) for unknown reason codes so an unrecognised code is treated
 * generously rather than silently blocking money.
 *
 * @param {string} reasonCode
 * @returns {number} 0–1
 */
export function getRefundFraction(reasonCode) {
  if (!reasonCode) return 1.0;
  const fraction = PARTIAL_REFUND_SCHEDULE[reasonCode];
  return Number.isFinite(fraction) ? fraction : 1.0;
}

/**
 * Returns the refund amount for a purchase given the reason code, clamped
 * to [0, paidAmount] and rounded to 7 decimal places (Stellar precision).
 *
 * @param {number} paidAmount
 * @param {string} [reasonCode]
 * @returns {number}
 */
export function calculateRefundAmount(paidAmount, reasonCode) {
  const fraction = Math.max(REFUND_MIN_FRACTION, getRefundFraction(reasonCode));
  const raw = Number(paidAmount) * fraction;
  return Math.max(0, Math.min(Number(paidAmount), parseFloat(raw.toFixed(7))));
}
