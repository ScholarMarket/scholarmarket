export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/promo-codes  – list all promo codes (filterable)
 * POST /api/admin/promo-codes  – create a new promo code
 *
 * Both operations require admin authentication (verifyAdminAuth).
 * All mutations are audit-logged.
 */

import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyAdminAuth } from '@/lib/auth/adminAuth';
import { auditLog } from '@/lib/api/audit';
import { logger } from '@/lib/logger';
import { buildPromoDocument } from '@/lib/checkout/promoService';

const ROUTE = 'admin/promo-codes';
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX     = 100;

// ── GET — list / filter ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/promo-codes:
 *   get:
 *     summary: List promo codes
 *     tags: [Admin]
 *     description: Returns a paginated list of promo codes. Supports filtering by active status and code substring.
 *     parameters:
 *       - in: query
 *         name: active
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive substring match on the code field.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated list of promo codes
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
export async function GET(request) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1);
    const limit = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT),
    );
    const skip = (page - 1) * limit;

    const filter = {};

    const activeParam = searchParams.get('active');
    if (activeParam !== null) {
      filter.active = activeParam !== 'false';
    }

    const search = searchParams.get('search')?.trim();
    if (search) {
      filter.code = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const materialId = searchParams.get('materialId')?.trim();
    if (materialId) {
      filter.materialIds = materialId;
    }

    const db    = await getDb();
    const col   = db.collection('promo_codes');
    const total = await col.countDocuments(filter);
    const docs  = await col
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return NextResponse.json({
      data:  docs,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error({ err: err.message }, `GET /${ROUTE} error`);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── POST — create ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/promo-codes:
 *   post:
 *     summary: Create a promo code
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, discountPct]
 *             properties:
 *               code:          { type: string }
 *               discountPct:   { type: number, minimum: 0, maximum: 100 }
 *               maxUses:       { type: integer, nullable: true }
 *               perUserLimit:  { type: integer, nullable: true }
 *               startsAt:      { type: string, format: date-time, nullable: true }
 *               expiresAt:     { type: string, format: date-time, nullable: true }
 *               materialIds:   { type: array, items: { type: string } }
 *               active:        { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Created promo code
 *       400:
 *         description: Validation errors
 *       409:
 *         description: Code already exists
 */
export async function POST(request) {
  try {
    const auth = await verifyAdminAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const admin = auth.user;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const built = buildPromoDocument(body, false);
    if (!built.ok) {
      return NextResponse.json({ error: 'Validation failed', errors: built.errors }, { status: 400 });
    }

    const db  = await getDb();
    const col = db.collection('promo_codes');

    // Uniqueness check (a unique index on `code` enforces this at the DB level
    // too, but we give a 409 rather than a 500).
    const existing = await col.findOne({ code: built.doc.code });
    if (existing) {
      return NextResponse.json(
        { error: `Promo code "${built.doc.code}" already exists.` },
        { status: 409 },
      );
    }

    const result = await col.insertOne(built.doc);

    auditLog({
      event:  'admin_promo_created',
      route:  ROUTE,
      method: 'POST',
      status: 201,
      actor:  admin.walletAddress || admin.sub || 'admin',
      target: built.doc.code,
    });

    logger.info({ code: built.doc.code, adminId: admin.sub }, 'Promo code created');

    return NextResponse.json(
      { success: true, _id: result.insertedId, code: built.doc },
      { status: 201 },
    );
  } catch (err) {
    logger.error({ err: err.message }, `POST /${ROUTE} error`);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
