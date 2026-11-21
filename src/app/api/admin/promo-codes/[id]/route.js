export const dynamic = 'force-dynamic';

/**
 * GET    /api/admin/promo-codes/:id  – fetch a single promo code by ObjectId
 * PATCH  /api/admin/promo-codes/:id  – partial update (fields listed in buildPromoDocument)
 * DELETE /api/admin/promo-codes/:id  – hard-delete a promo code
 *
 * All operations require admin authentication.
 * All mutations are audit-logged.
 */

import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyAdminAuth } from '@/lib/auth/adminAuth';
import { auditLog } from '@/lib/api/audit';
import { logger } from '@/lib/logger';
import { buildPromoDocument } from '@/lib/checkout/promoService';

const ROUTE = 'admin/promo-codes/[id]';

// ── Shared helpers ────────────────────────────────────────────────────────────

function parseId(id) {
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

async function findPromoById(col, id) {
  const oid = parseId(id);
  if (!oid) return null;
  return col.findOne({ _id: oid });
}

function notFound() {
  return NextResponse.json({ error: 'Promo code not found.' }, { status: 404 });
}

function badId() {
  return NextResponse.json({ error: 'Invalid promo code id.' }, { status: 400 });
}

// ── GET ───────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/promo-codes/{id}:
 *   get:
 *     summary: Fetch a single promo code
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Promo code document
 *       404:
 *         description: Not found
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!parseId(id)) return badId();

    const db  = await getDb();
    const doc = await findPromoById(db.collection('promo_codes'), id);
    if (!doc) return notFound();

    return NextResponse.json(doc);
  } catch (err) {
    logger.error({ err: err.message }, `GET /${ROUTE} error`);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/promo-codes/{id}:
 *   patch:
 *     summary: Partially update a promo code
 *     tags: [Admin]
 *     description: >
 *       All fields are optional. `code` cannot be changed after creation.
 *       Pass `active: false` to deactivate without deleting.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               discountPct:   { type: number }
 *               maxUses:       { type: integer, nullable: true }
 *               perUserLimit:  { type: integer, nullable: true }
 *               startsAt:      { type: string, format: date-time, nullable: true }
 *               expiresAt:     { type: string, format: date-time, nullable: true }
 *               materialIds:   { type: array, items: { type: string } }
 *               active:        { type: boolean }
 *     responses:
 *       200:
 *         description: Updated promo code document
 *       400:
 *         description: Validation errors
 *       404:
 *         description: Not found
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    const { id } = await params;
    if (!parseId(id)) return badId();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Strip `code` from PATCH body — codes are immutable after creation.
    const { code: _ignored, ...patchFields } = body;

    if (Object.keys(patchFields).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided.' }, { status: 400 });
    }

    const built = buildPromoDocument(patchFields, true);
    if (!built.ok) {
      return NextResponse.json({ error: 'Validation failed', errors: built.errors }, { status: 400 });
    }

    const db  = await getDb();
    const col = db.collection('promo_codes');
    const oid = parseId(id);

    const existing = await col.findOne({ _id: oid });
    if (!existing) return notFound();

    const updated = await col.findOneAndUpdate(
      { _id: oid },
      { $set: built.doc },
      { returnDocument: 'after' },
    );

    auditLog({
      event:  'admin_promo_updated',
      route:  ROUTE,
      method: 'PATCH',
      status: 200,
      actor:  admin.walletAddress || admin.sub || 'admin',
      target: existing.code,
    });

    logger.info({ id, code: existing.code, adminId: admin.sub }, 'Promo code updated');

    return NextResponse.json({ success: true, code: updated });
  } catch (err) {
    logger.error({ err: err.message }, `PATCH /${ROUTE} error`);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/promo-codes/{id}:
 *   delete:
 *     summary: Hard-delete a promo code
 *     tags: [Admin]
 *     description: >
 *       Permanently removes the promo code document.  Prefer PATCH active:false
 *       for a soft deactivation that preserves audit history.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    const { id } = await params;
    if (!parseId(id)) return badId();

    const db  = await getDb();
    const col = db.collection('promo_codes');
    const oid = parseId(id);

    const existing = await col.findOne({ _id: oid });
    if (!existing) return notFound();

    await col.deleteOne({ _id: oid });

    auditLog({
      event:  'admin_promo_deleted',
      route:  ROUTE,
      method: 'DELETE',
      status: 200,
      actor:  admin.walletAddress || admin.sub || 'admin',
      target: existing.code,
    });

    logger.info({ id, code: existing.code, adminId: admin.sub }, 'Promo code deleted');

    return NextResponse.json({ success: true, deleted: existing.code });
  } catch (err) {
    logger.error({ err: err.message }, `DELETE /${ROUTE} error`);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
