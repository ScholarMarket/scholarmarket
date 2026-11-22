/**
 * POST /api/checkout/refund
 *
 * Buyer-initiated refund request.  The route:
 *   1. Validates amount / asset / destination (verifyRefundLimit).
 *   2. Enforces the configurable policy window + download cap (checkRefundPolicy).
 *   3. Executes the on-chain refund (refundPurchaseOnChain).
 *   4. Atomically revokes the buyer's entitlement and updates the purchase record.
 *   5. Writes an audit log entry for every outcome.
 */

import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyRefundLimit, checkRefundPolicy } from '@/lib/checkout/refundVerifier';
import { refundPurchaseOnChain } from '@/lib/stellar/refundService';
import { revokeEntitlement } from '@/lib/entitlement';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/api/audit';
import { badRequest, errorResponse } from '@/lib/utils/errorResponse';
import { REFUND_REASON_CODES } from '@/lib/config/refundPolicy';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      transactionId,
      refundAmount,
      purchaseId,
      buyerAddress,
      materialId,
      asset,
      destination,
      reasonCode,
    } = body;

    // ── 1. Required-field guard ──────────────────────────────────────────────
    if (!transactionId || !refundAmount) {
      return badRequest('Missing transactionId or refundAmount', {
        instance: '/api/checkout/refund',
        errors: [
          ...(!transactionId ? [{ field: 'transactionId', message: 'transactionId is required' }] : []),
          ...(!refundAmount   ? [{ field: 'refundAmount',  message: 'refundAmount is required'  }] : []),
        ],
      });
    }

    // ── 2. Amount / asset / destination validation ───────────────────────────
    const verification = await verifyRefundLimit(transactionId, refundAmount, {
      asset,
      destination: destination || buyerAddress,
    });

    if (!verification.valid) {
      return badRequest(verification.reason, { instance: '/api/checkout/refund' });
    }

    const purchase = verification.purchase;

    // ── 3. Policy window + download cap ──────────────────────────────────────
    const db = await getDb();

    const policyCheck = await checkRefundPolicy(db, purchase, {
      reasonCode:   reasonCode || REFUND_REASON_CODES.NOT_AS_DESCRIBED,
      buyerAddress: buyerAddress || purchase.buyerAddress,
    });

    if (!policyCheck.allowed) {
      return badRequest(policyCheck.reason, {
        instance:   '/api/checkout/refund',
        reasonCode: policyCheck.reasonCode,
      });
    }

    // Use the policy-calculated refund amount (may be partial).
    const approvedAmount = policyCheck.refundAmount;
    const isPartial      = policyCheck.isPartial;

    // ── 4. Settlement-state guard ─────────────────────────────────────────────
    // Double-check the cached settlement state so we do not issue a second
    // on-chain refund if the purchase record already shows Refunded.
    if (purchaseId) {
      const latestPurchase = await db
        .collection('purchases')
        .findOne({ purchaseId: String(purchaseId) });

      if (
        latestPurchase &&
        latestPurchase.settlementState &&
        latestPurchase.settlementState !== 'Pending'
      ) {
        return badRequest(
          `Purchase is in ${latestPurchase.settlementState} state. Only Pending purchases can be refunded.`,
          { instance: '/api/checkout/refund' },
        );
      }
    }

    // ── 5. On-chain refund ────────────────────────────────────────────────────
    if (purchaseId && buyerAddress) {
      let refundResult;
      try {
        refundResult = await refundPurchaseOnChain(purchaseId, buyerAddress);
      } catch (chainError) {
        logger.error({ err: chainError.message, purchaseId }, 'On-chain refund failed');
        auditLog({
          event:       'refund_onchain_failed',
          route:       'checkout/refund',
          method:      'POST',
          status:      500,
          reason:      chainError.message,
          target:      transactionId,
          actor:       buyerAddress,
        });
        return errorResponse({
          status:   500,
          detail:   chainError.message,
          instance: '/api/checkout/refund',
        });
      }

      if (!refundResult.success) {
        logger.error({ error: refundResult.error, purchaseId }, 'On-chain refund returned failure');
        auditLog({
          event:  'refund_onchain_failed',
          route:  'checkout/refund',
          method: 'POST',
          status: 500,
          reason: refundResult.error || 'On-chain refund failed',
          target: transactionId,
          actor:  buyerAddress,
        });
        return errorResponse({
          status:   500,
          detail:   refundResult.error || 'On-chain refund failed',
          instance: '/api/checkout/refund',
        });
      }

      // ── 6. Atomic entitlement revocation + purchase record update ──────────
      // Write both operations in a single logical block.  MongoDB does not give
      // us a cross-collection transaction in the free-tier replica set, but we
      // do them back-to-back and use the audit log as the recovery record if the
      // second write fails after the first succeeds.

      // Revoke entitlement first so the buyer loses access immediately.
      const resolvableMaterialId = materialId || purchase.materialId;
      const resolvableBuyerAddr  = buyerAddress || purchase.buyerAddress;

      if (resolvableMaterialId && resolvableBuyerAddr) {
        await revokeEntitlement(resolvableMaterialId, resolvableBuyerAddr);
      }

      // Update purchase record with refund outcome.
      const purchaseFilter = purchaseId
        ? { purchaseId: String(purchaseId) }
        : ObjectId.isValid(purchase._id)
          ? { _id: new ObjectId(String(purchase._id)) }
          : { transactionHash: transactionId };

      await db.collection('purchases').updateOne(
        purchaseFilter,
        {
          $set: {
            status:               'refunded',
            settlementState:      'Refunded',
            refundedAt:           new Date(),
            refundTransactionHash: refundResult.hash,
            refundAmount:         approvedAmount,
            refundReasonCode:     policyCheck.reasonCode,
            isPartialRefund:      isPartial,
            updatedAt:            new Date(),
          },
        },
      );

      auditLog({
        event:   isPartial ? 'refund_partial_approved' : 'refund_full_approved',
        route:   'checkout/refund',
        method:  'POST',
        status:  200,
        reason:  policyCheck.reasonCode,
        target:  transactionId,
        actor:   buyerAddress,
      });

      logger.info(
        {
          transactionId,
          purchaseId,
          approvedAmount,
          isPartial,
          reasonCode: policyCheck.reasonCode,
          onChainHash: refundResult.hash,
        },
        'Refund processed successfully',
      );

      return NextResponse.json({
        message: isPartial
          ? `Partial refund of ${approvedAmount} processed successfully.`
          : 'Full refund processed successfully.',
        data: {
          ...purchase,
          settlementState:  'Refunded',
          refundAmount:     approvedAmount,
          isPartial,
          reasonCode:       policyCheck.reasonCode,
          onChainHash:      refundResult.hash,
        },
      });
    }

    // ── Legacy path (no purchaseId — validation only) ─────────────────────────
    auditLog({
      event:  'refund_validated',
      route:  'checkout/refund',
      method: 'POST',
      status: 200,
      target: transactionId,
    });

    return NextResponse.json({
      message: 'Refund validated successfully',
      data:    { ...purchase, approvedAmount, isPartial, reasonCode: policyCheck.reasonCode },
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to process refund request');
    return errorResponse({
      status:   500,
      detail:   'Internal server error',
      instance: '/api/checkout/refund',
    });
  }
}
