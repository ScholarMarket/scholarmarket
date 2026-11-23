export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { getUserFromCookie } from '@/lib/api/auth';
import { withApiHardening } from '@/lib/api/hardening';
import { auditLog } from '@/lib/api/audit';
import { validateUploadedFile } from '@/lib/ipfs/uploadValidator';
import { validateUploadFileMetadata } from '@/lib/api/validation';
import { pinata } from '@/lib/pinata';
import { normalizeBuyerAddress } from '@/lib/purchases/access';
import { enqueueSideEffect } from '@/lib/backend/outbox';
import { invalidateMarketplaceCache } from '@/lib/cache/redis';
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/materials/uploadValidation';
import { applyRevision } from '@/lib/materials/revisions';

const COMPLETED_PURCHASE_STATUSES = ['confirmed', 'settled', 'completed'];
const NOTIFICATION_BUYER_LIMIT = 200;

/** Collects distinct buyer emails from completed purchases of a material. */
async function collectBuyerEmails(db, materialId) {
  const purchases = await db.collection('purchases')
    .find({ materialId, status: { $in: COMPLETED_PURCHASE_STATUSES } })
    .project({ buyerAddress: 1, userEmail: 1 })
    .limit(NOTIFICATION_BUYER_LIMIT)
    .toArray();

  const emails = new Set();
  const addressesWithoutEmail = [];
  for (const purchase of purchases) {
    if (purchase.userEmail) {
      emails.add(String(purchase.userEmail).toLowerCase());
      continue;
    }
    const address = normalizeBuyerAddress(purchase.buyerAddress);
    if (address) addressesWithoutEmail.push(address);
  }

  if (addressesWithoutEmail.length > 0) {
    const users = await db.collection('users')
      .find({
        $or: addressesWithoutEmail.flatMap((address) => [
          { walletAddress: address },
          { walletAddressLower: address.toLowerCase() },
        ]),
      })
      .project({ email: 1 })
      .limit(NOTIFICATION_BUYER_LIMIT)
      .toArray();
    for (const user of users) {
      if (user.email) emails.add(String(user.email).toLowerCase());
    }
  }

  return [...emails];
}

/** Enqueues one reliable email intent per buyer for a published revision. */
export async function notifyBuyersOfRevision(db, material, revision, materialId) {
  const emails = await collectBuyerEmails(db, materialId);
  const sanitizedMaterial = {
    title: material.title,
    _id: material._id,
    materialId: material.materialId || materialId,
  };

  for (const email of emails) {
    await enqueueSideEffect({
      sourceAggregate: 'material',
      sourceId: String(material._id || materialId),
      intent: {
        type: 'email',
        channel: 'material_revision',
        payload: { email, material: sanitizedMaterial, revision },
      },
    });
  }

  return emails.length;
}

export async function POST(request, { params }) {
  return withApiHardening(
    request,
    { route: 'material-revisions', rateLimit: { limit: 20, windowMs: 60_000 } },
    async () => {
      const { id } = await params;
      if (!id || !ObjectId.isValid(id)) {
        auditLog({ event: 'revision_invalid_id', route: 'material-revisions', method: 'POST', status: 400, materialId: id });
        return NextResponse.json({ error: 'Invalid material ID' }, { status: 400 });
      }

      const user = await getUserFromCookie(request);
      if (!user) {
        auditLog({ event: 'revision_auth_failed', route: 'material-revisions', method: 'POST', status: 401 });
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      const userAddress = normalizeBuyerAddress(user.walletAddress || user.address || user.id);
      if (!userAddress) {
        auditLog({ event: 'revision_no_address', route: 'material-revisions', method: 'POST', status: 400 });
        return NextResponse.json({ error: 'No wallet address on account' }, { status: 400 });
      }

      try {
        const db = await getDb();
        const material = await db.collection('materials').findOne({ _id: new ObjectId(id) });
        if (!material) {
          auditLog({ event: 'revision_not_found', route: 'material-revisions', method: 'POST', status: 404, materialId: id });
          return NextResponse.json({ error: 'Material not found' }, { status: 404 });
        }

        const isOwner =
          normalizeBuyerAddress(material.userAddress) === userAddress ||
          normalizeBuyerAddress(material.ownerAddress) === userAddress;
        if (!isOwner) {
          auditLog({ event: 'revision_forbidden', route: 'material-revisions', method: 'POST', status: 403, materialId: id });
          return NextResponse.json({ error: 'Only the material owner can publish revisions' }, { status: 403 });
        }

        const form = await request.formData();
        const file = form.get('file');
        if (!file) {
          return NextResponse.json({ error: 'No document file provided.' }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json({ error: `File size exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.` }, { status: 413 });
        }
        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
          return NextResponse.json({ error: `Unsupported file type: ${file.type || 'unknown'}.` }, { status: 415 });
        }

        const fileCheck = await validateUploadedFile(file, ALLOWED_FILE_TYPES);
        if (!fileCheck.valid) {
          auditLog({ event: 'revision_upload_blocked', route: 'material-revisions', method: 'POST', status: 422, reason: fileCheck.reason });
          return NextResponse.json({ error: fileCheck.reason }, { status: 422 });
        }

        try {
          validateUploadFileMetadata(file, 'file');
        } catch (validationErr) {
          return NextResponse.json({ error: validationErr.message }, { status: 400 });
        }

        const changelog = typeof form.get('changelog') === 'string'
          ? form.get('changelog').slice(0, 2000)
          : '';

        const uploadedFile = await pinata.upload.public.file(file);
        const now = new Date();
        const published = applyRevision({
          material,
          file: {
            cid: uploadedFile.cid,
            storageKey: uploadedFile.cid,
            size: file.size,
            contentType: file.type,
            fileName: file.name || material.fileName || material.title,
          },
          changelog,
          now,
        });

        await db.collection('materials').updateOne(
          { _id: new ObjectId(id) },
          { $set: published.updates },
        );

        const notified = await notifyBuyersOfRevision(db, material, published.revision, id);
        await invalidateMarketplaceCache();

        auditLog({
          event: 'revision_published',
          route: 'material-revisions',
          method: 'POST',
          status: 201,
          materialId: id,
          revisionId: published.revision.id,
          notified,
        });

        return NextResponse.json({
          success: true,
          revision: published.revision,
          revisions: published.revisions,
          cid: published.updates.cid,
          notifiedBuyers: notified,
        }, { status: 201 });
      } catch (err) {
        auditLog({ event: 'revision_failed', route: 'material-revisions', method: 'POST', status: 500, reason: err?.message });
        return NextResponse.json({ error: err?.message || 'Unable to publish revision' }, { status: 500 });
      }
    },
  );
}
