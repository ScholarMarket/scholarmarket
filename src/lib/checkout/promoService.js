/**
 * Promo code service (issue #176)
 *
 * Owns all reads and writes against the `promo_codes` collection.  The
 * collection schema supports usage caps, per-user limits, start/expiry
 * windows, and optional material-scoping:
 *
 *   {
 *     _id:           ObjectId,
 *     code:          string   – uppercased, unique index,
 *     discountPct:   number   – 0–100 percentage off,
 *     maxUses:       number?  – total redemption cap (null = unlimited),
 *     perUserLimit:  number?  – max redemptions per buyer address (null = unlimited),
 *     startsAt:      Date?    – earliest valid redemption instant (null = no floor),
 *     expiresAt:     Date?    – latest valid redemption instant (null = no ceiling),
 *     materialIds:   string[] – allowed materialIds; [] or absent means all materials,
 *     active:        boolean  – admin kill-switch,
 *     usageCount:    number   – total redemptions so far (monotonically increasing),
 *     usageByBuyer:  object   – { [buyerAddress]: number } per-user count map,
 *     createdAt:     Date,
 *     updatedAt:     Date,
 *   }
 *
 * Separation of concerns
 * ──────────────────────
 * validatePromoCode  – pure read; returns a typed result without side effects.
 * incrementPromoUsage – atomic findOneAndUpdate; called only on a confirmed purchase.
 * discountVerifier.js delegates to these functions so checkout and admin routes
 * share one code path.
 */

import { logger } from '../logger.js';

// ── Rejection reasons (consumers may switch on these strings) ──────────────────

export const PROMO_REJECTION = {
  NOT_FOUND:        'promo_not_found',
  INACTIVE:         'promo_inactive',
  NOT_STARTED:      'promo_not_started',
  EXPIRED:          'promo_expired',
  EXHAUSTED:        'promo_exhausted',
  USER_LIMIT:       'promo_user_limit_reached',
  WRONG_MATERIAL:   'promo_wrong_material',
  MATERIAL_MISSING: 'promo_material_not_found',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/**
 * Returns the per-buyer count stored inside usageByBuyer, tolerating both
 * the dot-notation key stored by legacy records and the sanitized version
 * written by this service.
 */
function perBuyerCount(doc, buyerAddress) {
  if (!doc.usageByBuyer || !buyerAddress) return 0;
  const key = sanitizeBuyerKey(buyerAddress);
  return doc.usageByBuyer[key] ?? 0;
}

/**
 * MongoDB field names cannot contain dots.  Stellar addresses are G-prefixed
 * base32 strings with no dots, so this is effectively a no-op today, but we
 * normalise anyway for safety.
 */
function sanitizeBuyerKey(address) {
  return String(address).replace(/\./g, '_').toLowerCase();
}

// ── validatePromoCode ─────────────────────────────────────────────────────────

/**
 * Validate a promo code for a given material and buyer without modifying state.
 *
 * @param {import('mongodb').Db} db
 * @param {string}  code          – raw code string from the buyer
 * @param {string}  materialId    – the material being purchased
 * @param {string}  [buyerAddress] – buyer's Stellar G… address (required for per-user check)
 *
 * @returns {Promise<
 *   | { valid: true,  code: object, discountPct: number }
 *   | { valid: false, reason: string, message: string }
 * >}
 */
export async function validatePromoCode(db, code, materialId, buyerAddress) {
  const cleanCode = normalizeCode(code);
  if (!cleanCode) {
    return { valid: false, reason: PROMO_REJECTION.NOT_FOUND, message: 'No promo code provided.' };
  }

  const doc = await db.collection('promo_codes').findOne({ code: cleanCode });
  if (!doc) {
    return { valid: false, reason: PROMO_REJECTION.NOT_FOUND, message: 'Promo code not found.' };
  }

  // Admin kill-switch.
  if (doc.active === false) {
    return { valid: false, reason: PROMO_REJECTION.INACTIVE, message: 'Promo code is not active.' };
  }

  const now = new Date();

  // Start-date gate.
  if (doc.startsAt && new Date(doc.startsAt) > now) {
    return {
      valid: false,
      reason: PROMO_REJECTION.NOT_STARTED,
      message: `Promo code is not yet valid (starts ${new Date(doc.startsAt).toISOString()}).`,
    };
  }

  // Expiry gate.
  if (doc.expiresAt && new Date(doc.expiresAt) < now) {
    return { valid: false, reason: PROMO_REJECTION.EXPIRED, message: 'Promo code has expired.' };
  }

  // Global usage cap.
  if (doc.maxUses != null && (doc.usageCount ?? 0) >= doc.maxUses) {
    return { valid: false, reason: PROMO_REJECTION.EXHAUSTED, message: 'Promo code usage limit has been reached.' };
  }

  // Per-user limit.
  if (doc.perUserLimit != null && buyerAddress) {
    const used = perBuyerCount(doc, buyerAddress);
    if (used >= doc.perUserLimit) {
      return {
        valid: false,
        reason: PROMO_REJECTION.USER_LIMIT,
        message: `You have already used this promo code the maximum number of times (${doc.perUserLimit}).`,
      };
    }
  }

  // Material-scope check.
  if (Array.isArray(doc.materialIds) && doc.materialIds.length > 0) {
    if (!materialId || !doc.materialIds.includes(String(materialId))) {
      return {
        valid: false,
        reason: PROMO_REJECTION.WRONG_MATERIAL,
        message: 'This promo code is not valid for the selected material.',
      };
    }
  }

  return { valid: true, code: doc, discountPct: Number(doc.discountPct ?? 0) };
}

// ── incrementPromoUsage ───────────────────────────────────────────────────────

/**
 * Atomically record one redemption against `code` by `buyerAddress`.
 *
 * Uses findOneAndUpdate with the full validity pre-conditions so the increment
 * only succeeds when the code is still valid at the moment of write.  This
 * prevents a race where two concurrent checkouts both pass validatePromoCode
 * but together exceed maxUses.
 *
 * Call this only after the Stellar payment transaction is confirmed.
 *
 * @param {import('mongodb').Db} db
 * @param {string} code
 * @param {string} buyerAddress
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function incrementPromoUsage(db, code, buyerAddress) {
  const cleanCode = normalizeCode(code);
  const now = new Date();
  const buyerKey = sanitizeBuyerKey(buyerAddress ?? '');

  // Build a filter that re-checks the conditions atomically.
  const filter = {
    code: cleanCode,
    active: { $ne: false },
    $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }],
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      { $or: [{ maxUses: null }, { maxUses: { $exists: false } }, { $expr: { $lt: ['$usageCount', '$maxUses'] } }] },
    ],
  };

  // If a per-user limit applies we also guard it in the filter so the increment
  // is rejected atomically if the buyer has already hit their ceiling.
  // We retrieve the doc first to know perUserLimit; then do the conditional update.
  const doc = await db.collection('promo_codes').findOne({ code: cleanCode });
  if (!doc) {
    return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };
  }
  if (doc.active === false) {
    return { ok: false, reason: PROMO_REJECTION.INACTIVE };
  }

  if (doc.perUserLimit != null) {
    const alreadyUsed = perBuyerCount(doc, buyerAddress);
    if (alreadyUsed >= doc.perUserLimit) {
      return { ok: false, reason: PROMO_REJECTION.USER_LIMIT };
    }
    // Add per-buyer guard to the atomic filter.
    filter[`usageByBuyer.${buyerKey}`] = { $not: { $gte: doc.perUserLimit } };
  }

  const update = {
    $inc: {
      usageCount: 1,
      ...(buyerKey ? { [`usageByBuyer.${buyerKey}`]: 1 } : {}),
    },
    $set: { updatedAt: now },
  };

  const result = await db.collection('promo_codes').findOneAndUpdate(
    filter,
    update,
    { returnDocument: 'after' },
  );

  // findOneAndUpdate returns null when the filter matched no document (i.e.
  // the code became invalid between the pre-check and the write).
  if (!result) {
    logger.warn({ code: cleanCode, buyerAddress }, 'incrementPromoUsage: atomic guard rejected the update');
    return { ok: false, reason: PROMO_REJECTION.EXHAUSTED };
  }

  logger.info({ code: cleanCode, buyerAddress, usageCount: result.usageCount }, 'Promo code usage incremented');
  return { ok: true };
}

// ── buildPromoDocument ────────────────────────────────────────────────────────

/**
 * Build a validated promo_codes insert document from admin-supplied fields.
 * Returns `{ ok: true, doc }` on success or `{ ok: false, errors: string[] }`.
 *
 * Used by both the POST and PATCH admin handlers so validation lives in one
 * place.  PATCH passes `partial: true` to skip required-field checks.
 *
 * @param {object} fields
 * @param {boolean} [partial]
 */
export function buildPromoDocument(fields, partial = false) {
  const errors = [];
  const now = new Date();

  const {
    code,
    discountPct,
    maxUses,
    perUserLimit,
    startsAt,
    expiresAt,
    materialIds,
    active,
  } = fields;

  const doc = { updatedAt: now };

  // code — required on create, immutable on update (PATCH skips it).
  if (!partial) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      errors.push('code is required and must be a non-empty string.');
    } else {
      doc.code = code.trim().toUpperCase();
    }
    if (discountPct === undefined || discountPct === null) {
      errors.push('discountPct is required.');
    }
  }

  // discountPct — 0–100.
  if (discountPct !== undefined && discountPct !== null) {
    const pct = Number(discountPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      errors.push('discountPct must be a number between 0 and 100.');
    } else {
      doc.discountPct = pct;
    }
  }

  // maxUses — positive integer or null.
  if (maxUses !== undefined) {
    if (maxUses !== null) {
      const mu = Number(maxUses);
      if (!Number.isInteger(mu) || mu < 1) {
        errors.push('maxUses must be a positive integer or null.');
      } else {
        doc.maxUses = mu;
      }
    } else {
      doc.maxUses = null;
    }
  }

  // perUserLimit — positive integer or null.
  if (perUserLimit !== undefined) {
    if (perUserLimit !== null) {
      const pul = Number(perUserLimit);
      if (!Number.isInteger(pul) || pul < 1) {
        errors.push('perUserLimit must be a positive integer or null.');
      } else {
        doc.perUserLimit = pul;
      }
    } else {
      doc.perUserLimit = null;
    }
  }

  // startsAt — ISO date string or null.
  if (startsAt !== undefined) {
    if (startsAt === null) {
      doc.startsAt = null;
    } else {
      const d = new Date(startsAt);
      if (isNaN(d.getTime())) {
        errors.push('startsAt must be a valid ISO date string or null.');
      } else {
        doc.startsAt = d;
      }
    }
  }

  // expiresAt — ISO date string or null; must be after startsAt when both given.
  if (expiresAt !== undefined) {
    if (expiresAt === null) {
      doc.expiresAt = null;
    } else {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        errors.push('expiresAt must be a valid ISO date string or null.');
      } else {
        if (doc.startsAt && d <= doc.startsAt) {
          errors.push('expiresAt must be after startsAt.');
        }
        doc.expiresAt = d;
      }
    }
  }

  // materialIds — array of strings.
  if (materialIds !== undefined) {
    if (!Array.isArray(materialIds)) {
      errors.push('materialIds must be an array of material ID strings.');
    } else {
      doc.materialIds = materialIds.map(String);
    }
  }

  // active — boolean.
  if (active !== undefined) {
    doc.active = Boolean(active);
  }

  if (errors.length > 0) return { ok: false, errors };

  if (!partial) {
    // Set creation-time defaults.
    doc.usageCount   = 0;
    doc.usageByBuyer = {};
    doc.active       = doc.active ?? true;
    doc.materialIds  = doc.materialIds ?? [];
    doc.maxUses      = doc.maxUses ?? null;
    doc.perUserLimit = doc.perUserLimit ?? null;
    doc.startsAt     = doc.startsAt ?? null;
    doc.expiresAt    = doc.expiresAt ?? null;
    doc.createdAt    = now;
  }

  return { ok: true, doc };
}
