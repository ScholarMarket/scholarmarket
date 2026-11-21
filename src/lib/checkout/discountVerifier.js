/**
 * Discount / promo code verifier.
 *
 * verifyDiscount delegates to the new promoService (promo_codes collection,
 * issue #176) first, then falls back to the legacy discount_codes collection
 * so existing codes keep working until they are migrated.
 *
 * Usage increment (atomic) is NOT called here — it must be called by the
 * purchase-confirmation path after the Stellar transaction is confirmed:
 *
 *   import { incrementPromoUsage } from '@/lib/checkout/promoService';
 *   await incrementPromoUsage(db, code, buyerAddress);
 */

import { marketplaceListings } from '../marketplace/listings.js';
import { validatePromoCode, PROMO_REJECTION } from './promoService.js';

let ObjectIdClass = null;
try {
  import('mongodb').then((m) => { ObjectIdClass = m.ObjectId; }).catch(() => {});
} catch (e) {}

// ── findMaterial (unchanged public API) ───────────────────────────────────────

export async function findMaterial(materialId, db = null) {
  if (!materialId) return null;

  if (db || globalThis._mongoClientPromise) {
    try {
      const activeDb = db || (await (await import('../mongodb.js')).getDb());
      let doc = null;
      if (ObjectIdClass) {
        try {
          doc = await activeDb.collection('materials').findOne({ _id: new ObjectIdClass(materialId) });
        } catch (e) {}
      }
      if (!doc) {
        doc = await activeDb.collection('materials').findOne({ _id: materialId });
      }
      if (doc) {
        return {
          id: doc._id.toString(),
          title: doc.title,
          price: doc.price,
          userAddress: doc.userAddress || doc.authorAddress || null,
          creatorAddress: doc.userAddress || doc.authorAddress || null,
        };
      }
    } catch (e) {
      if (!db) console.warn('Database lookup failed for material:', e?.message || e);
    }
  }

  const listing = marketplaceListings.find((l) => l.id === materialId);
  if (listing) {
    let price = 0;
    if (typeof listing.price === 'string') {
      price = parseFloat(listing.price.split(' ')[0]) || 0;
    } else if (typeof listing.price === 'number') {
      price = listing.price;
    }
    return {
      id: listing.id,
      title: listing.title,
      price,
      userAddress: listing.userAddress || listing.author?.walletAddress || null,
      creatorAddress: listing.userAddress || listing.author?.walletAddress || null,
    };
  }

  return null;
}

// ── verifyDiscount ────────────────────────────────────────────────────────────

/**
 * Verify a promo/discount code for a given material and optional buyer.
 *
 * Checks the new `promo_codes` collection first (full feature set: usage caps,
 * per-user limits, start/expiry, material scoping).  If the code is not found
 * there, falls back to the legacy `discount_codes` collection so pre-existing
 * codes continue to work without a data migration.
 *
 * Returns:
 *   { valid: true,  discountAmountPercent: number, reason?: undefined, source: 'promo'|'legacy' }
 *   { valid: false, reason: string }
 *
 * NOTE: Does not increment usageCount. Call incrementPromoUsage() after the
 * Stellar transaction confirms.
 *
 * @param {string}  codeString
 * @param {string}  materialId
 * @param {object}  [db]           – optional pre-resolved Mongo Db instance
 * @param {string}  [buyerAddress] – required for per-user limit enforcement
 */
export async function verifyDiscount(codeString, materialId, db = null, buyerAddress = null) {
  if (!codeString || !materialId) {
    return { valid: false, reason: 'Missing code or materialId' };
  }

  const cleanCode = String(codeString).trim().toUpperCase();
  const activeDb = db || (await (await import('../mongodb.js')).getDb());

  // ── 1. Try new promo_codes collection ──────────────────────────────────────
  try {
    const promoResult = await validatePromoCode(activeDb, cleanCode, materialId, buyerAddress);

    if (promoResult.valid) {
      return {
        valid: true,
        discountAmountPercent: promoResult.discountPct,
        source: 'promo',
        promoCode: promoResult.code,
      };
    }

    // A definitive rejection from the promo collection (code exists but is
    // invalid) — do not fall through to legacy.
    if (promoResult.reason !== PROMO_REJECTION.NOT_FOUND) {
      return { valid: false, reason: promoResult.message };
    }
  } catch (e) {
    console.warn('promoService.validatePromoCode error:', e?.message || e);
    // Fall through to legacy on unexpected errors.
  }

  // ── 2. Legacy discount_codes fallback ─────────────────────────────────────
  let discount = null;
  try {
    discount = await activeDb.collection('discount_codes').findOne({ code: cleanCode });
  } catch (e) {
    console.warn('Database lookup failed for discount code:', e?.message || e);
  }

  if (!discount) {
    return { valid: false, reason: 'Discount code not found' };
  }

  if (discount.expiresAt) {
    const expires = new Date(discount.expiresAt);
    if (isNaN(expires.getTime()) || expires < new Date()) {
      return { valid: false, reason: 'Discount code expired' };
    }
  }

  const usageCount = discount.usageCount || 0;
  if (discount.usageLimit != null && usageCount >= discount.usageLimit) {
    return { valid: false, reason: 'Discount code usage limit reached' };
  }

  const material = await findMaterial(materialId, activeDb);
  if (!material) {
    return { valid: false, reason: 'Material not found' };
  }

  if (discount.creatorAddress) {
    const materialCreator = (material.creatorAddress || material.userAddress || '').toLowerCase();
    if (materialCreator !== discount.creatorAddress.toLowerCase()) {
      return { valid: false, reason: "Discount code not valid for this creator's materials" };
    }
  }

  if (discount.materialId && discount.materialId !== materialId) {
    return { valid: false, reason: 'Discount code not valid for this material' };
  }

  return {
    valid: true,
    discountAmountPercent: discount.percentage || 0,
    source: 'legacy',
    discount,
  };
}
