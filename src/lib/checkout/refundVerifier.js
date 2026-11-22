/**
 * Refund verifier — hardened edition (issue #170).
 *
 * Public API (backward-compatible with pre-#170 callers):
 *   verifyRefundRequest(purchase, refundAmount, expected)    — pure, synchronous
 *   verifyRefundLimit(transactionId, refundAmount, expected) — DB look-up + above
 *
 * New exports:
 *   checkRefundPolicy(db, purchase, opts) — enforces window + download cap
 *   calculateRefundAmount(paid, reason)   — re-exported from config for callers
 */

import { getDb } from '../mongodb.js';
import { logger } from '../logger.js';
import { auditLog } from '../api/audit.js';
import {
  REFUND_WINDOW_DAYS,
  REFUND_MAX_DOWNLOADS,
  REFUND_REASON_CODES,
  calculateRefundAmount as _calculateRefundAmount,
} from '../config/refundPolicy.js';

export { calculateRefundAmount } from '../config/refundPolicy.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function msInDays(days) {
  return days * 24 * 60 * 60 * 1_000;
}

function purchaseDate(purchase) {
  const raw = purchase.purchasedAt || purchase.createdAt || purchase.updatedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function auditPolicyReject(reasonCode, purchaseId, actor) {
  auditLog({
    event: 'refund_policy_rejected',
    route: 'refundVerifier/checkRefundPolicy',
    method: 'CHECK',
    status: 400,
    reason: reasonCode,
    target: purchaseId,
    actor,
  });
}

// ── verifyRefundRequest ───────────────────────────────────────────────────────

/**
 * Pure synchronous validation of refund amount, asset, and destination.
 * Does NOT touch the database or enforce policy windows.
 *
 * @param {object} purchase
 * @param {number} refundAmount
 * @param {object} [expected]
 * @returns {{ valid: true, purchase, refundAmount, isPartial, originalAmount }
 *          |{ valid: false, reason: string }}
 */
export function verifyRefundRequest(purchase, refundAmount, expected = {}) {
  if (!purchase) return { valid: false, reason: 'Transaction not found' };

  const paidAmount  = Number(purchase.amount);
  const claimAmount = Number(refundAmount);

  if (!Number.isFinite(paidAmount) || !Number.isFinite(claimAmount)) {
    return { valid: false, reason: 'Invalid amount formats' };
  }
  if (claimAmount < 0) {
    return { valid: false, reason: 'Invalid refund amount' };
  }
  if (claimAmount > paidAmount) {
    return { valid: false, reason: 'Refund amount exceeds original purchase value' };
  }

  const expectedAsset  = expected.asset || expected.assetCode;
  const purchaseAsset  = purchase.asset || purchase.assetCode;
  if (
    expectedAsset && purchaseAsset &&
    String(expectedAsset).toUpperCase() !== String(purchaseAsset).toUpperCase()
  ) {
    return { valid: false, reason: 'Refund asset does not match original purchase' };
  }

  const expectedDest  = expected.destination || expected.destinationAddress || expected.buyerAddress;
  const purchaseDest  = purchase.destination || purchase.destinationAddress || purchase.buyerAddress;
  if (expectedDest && purchaseDest && String(expectedDest) !== String(purchaseDest)) {
    return { valid: false, reason: 'Refund destination does not match original purchase' };
  }

  const isPartial = claimAmount < paidAmount;
  return { valid: true, purchase, refundAmount: claimAmount, isPartial, originalAmount: paidAmount };
}

// ── checkRefundPolicy ─────────────────────────────────────────────────────────

/**
 * Enforces the configurable refund policy gates:
 *   1. Already-refunded guard.
 *   2. Wrong-status guard (only completed/confirmed/settled/pending allowed).
 *   3. Time window (REFUND_WINDOW_DAYS, default 7 days).
 *   4. Download cap (REFUND_MAX_DOWNLOADS, default 2; 0 = disabled).
 *
 * On approval, calculates the correct refund amount from the reason code via
 * PARTIAL_REFUND_SCHEDULE in config/refundPolicy.js.
 *
 * Every decision — approved or rejected — is written to the audit log.
 *
 * @param {import('mongodb').Db} db
 * @param {object} purchase
 * @param {object} [opts]
 * @param {string} [opts.reasonCode]   — buyer-supplied reason (REFUND_REASON_CODES key)
 * @param {string} [opts.buyerAddress]
 * @param {Date}   [opts.now]          — injectable clock for testing
 *
 * @returns {Promise<
 *   | { allowed: true,  refundAmount: number, reasonCode: string, isPartial: boolean }
 *   | { allowed: false, reason: string,       reasonCode: string }
 * >}
 */
export async function checkRefundPolicy(db, purchase, opts = {}) {
  const {
    reasonCode    = REFUND_REASON_CODES.NOT_AS_DESCRIBED,
    buyerAddress,
    now           = new Date(),
  } = opts;

  const purchaseId = String(
    purchase._id || purchase.purchaseId || purchase.transactionHash || '',
  );
  const actor = buyerAddress || purchase.buyerAddress || 'unknown';

  // 1. Already refunded ──────────────────────────────────────────────────────
  if (purchase.status === 'refunded' || purchase.settlementState === 'Refunded') {
    const reason = 'This purchase has already been refunded.';
    logger.warn({ purchaseId, actor }, 'Refund rejected: already refunded');
    auditPolicyReject(REFUND_REASON_CODES.ALREADY_REFUNDED, purchaseId, actor);
    return { allowed: false, reason, reasonCode: REFUND_REASON_CODES.ALREADY_REFUNDED };
  }

  // 2. Wrong settlement status ───────────────────────────────────────────────
  const allowedStatuses = new Set(['completed', 'confirmed', 'settled', 'pending']);
  const currentStatus   = (purchase.status || '').toLowerCase();
  if (currentStatus && !allowedStatuses.has(currentStatus)) {
    const reason = `Purchase is in '${purchase.status}' state and cannot be refunded.`;
    logger.warn({ purchaseId, actor, status: currentStatus }, 'Refund rejected: wrong status');
    auditPolicyReject(REFUND_REASON_CODES.WRONG_STATUS, purchaseId, actor);
    return { allowed: false, reason, reasonCode: REFUND_REASON_CODES.WRONG_STATUS };
  }

  // 3. Time window ───────────────────────────────────────────────────────────
  if (REFUND_WINDOW_DAYS > 0) {
    const pDate = purchaseDate(purchase);
    if (pDate) {
      const ageMs = now.getTime() - pDate.getTime();
      if (ageMs > msInDays(REFUND_WINDOW_DAYS)) {
        const days   = REFUND_WINDOW_DAYS;
        const reason = `The ${days}-day refund window has expired. `
          + `This purchase was made on ${pDate.toISOString().slice(0, 10)}.`;
        logger.warn(
          { purchaseId, actor, ageMs, windowMs: msInDays(days) },
          'Refund rejected: window expired',
        );
        auditPolicyReject(REFUND_REASON_CODES.WINDOW_EXPIRED, purchaseId, actor);
        return { allowed: false, reason, reasonCode: REFUND_REASON_CODES.WINDOW_EXPIRED };
      }
    }
  }

  // 4. Download cap ──────────────────────────────────────────────────────────
  if (REFUND_MAX_DOWNLOADS > 0) {
    try {
      const materialId = purchase.materialId;
      const buyerAddr  = buyerAddress || purchase.buyerAddress;
      if (materialId && buyerAddr) {
        const downloadCount = await db
          .collection('download_logs')
          .countDocuments({ materialId: String(materialId), buyerAddress: buyerAddr });

        if (downloadCount > REFUND_MAX_DOWNLOADS) {
          const limit  = REFUND_MAX_DOWNLOADS;
          const reason = `Refund is unavailable after more than ${limit} download${limit === 1 ? '' : 's'} `
            + `(${downloadCount} recorded for this material).`;
          logger.warn(
            { purchaseId, actor, downloadCount, limit },
            'Refund rejected: download limit exceeded',
          );
          auditPolicyReject(REFUND_REASON_CODES.DOWNLOAD_LIMIT, purchaseId, actor);
          return { allowed: false, reason, reasonCode: REFUND_REASON_CODES.DOWNLOAD_LIMIT };
        }
      }
    } catch (err) {
      // A failing download-log query must not silently allow or block a
      // legitimate refund. Log and continue; the cap is best-effort when the
      // collection is unavailable.
      logger.error(
        { err: err.message, purchaseId },
        'checkRefundPolicy: download count query failed — cap skipped',
      );
    }
  }

  // Approved ─────────────────────────────────────────────────────────────────
  const paidAmount   = Number(purchase.amount);
  const refundAmount = _calculateRefundAmount(paidAmount, reasonCode);
  const isPartial    = refundAmount < paidAmount;

  logger.info(
    { purchaseId, actor, paidAmount, refundAmount, reasonCode, isPartial },
    'Refund policy check approved',
  );
  auditLog({
    event:  'refund_policy_approved',
    route:  'refundVerifier/checkRefundPolicy',
    method: 'CHECK',
    status: 200,
    reason: reasonCode,
    target: purchaseId,
    actor,
  });

  return { allowed: true, refundAmount, reasonCode, isPartial };
}

// ── verifyRefundLimit ─────────────────────────────────────────────────────────

/**
 * Backward-compatible: looks up the purchase by transactionHash, runs
 * verifyRefundRequest, and audit-logs failures.
 * Does NOT enforce the policy window — call checkRefundPolicy separately.
 *
 * @param {string} transactionId
 * @param {number} refundAmount
 * @param {object} [expected]
 * @returns {Promise<
 *   | { valid: true, purchase, refundAmount, isPartial, originalAmount }
 *   | { valid: false, reason: string }
 * >}
 */
export async function verifyRefundLimit(transactionId, refundAmount, expected = {}) {
  const db       = await getDb();
  const purchase = await db.collection('purchases').findOne({ transactionHash: transactionId });

  if (!purchase) {
    logger.warn({ transactionId, refundAmount }, 'Refund requested for unknown transaction');
    auditLog({
      event:  'refund_rejected_not_found',
      route:  'refundVerifier/verifyRefundLimit',
      method: 'CHECK',
      status: 404,
      reason: 'Transaction not found',
      target: transactionId,
    });
    return { valid: false, reason: 'Transaction not found' };
  }

  const verification = verifyRefundRequest(purchase, refundAmount, expected);
  if (!verification.valid) {
    logger.warn(
      {
        transactionId,
        paidAmount:   Number(purchase.amount),
        claimAmount:  Number(refundAmount),
        reason:       verification.reason,
      },
      'Refund rejected',
    );
    auditLog({
      event:  'refund_rejected',
      route:  'refundVerifier/verifyRefundLimit',
      method: 'CHECK',
      status: 400,
      reason: verification.reason,
      target: transactionId,
    });
  }

  return verification;
}
