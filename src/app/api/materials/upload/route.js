export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auditLog } from '@/lib/api/audit';
import { withApiHardening } from '@/lib/api/hardening';
import { processUpload } from '@/lib/ipfs/uploadService';

/**
 * POST /api/materials/upload — canonical upload endpoint.
 *
 * The route owns auth, request parsing, audit logging and the response. All
 * validation, Pinata pinning and persistence live in the shared
 * `src/lib/ipfs/uploadService.js` pipeline so the legacy `/api/upload` route can
 * delegate here without duplicating logic.
 */
export async function POST(request) {
  return withApiHardening(
    request,
    { route: 'materials/upload', rateLimit: { limit: 20, windowMs: 60_000 } },
    async () => {
      try {
        const form = await request.formData();
        const file = form.get('file');
        const image = form.get('thumbnail');
        const uploaderAddress =
          request.headers.get('x-wallet-address') || form.get('owner') || 'anonymous';

        const result = await processUpload({ file, image, form, uploaderAddress });

        if (!result.ok) {
          auditLog({
            event: result.event,
            route: 'materials/upload',
            method: 'POST',
            status: result.status,
            reason: result.auditReason,
          });
          return NextResponse.json({ error: result.reason }, { status: result.status });
        }

        auditLog({
          event: 'upload_quarantined',
          route: 'materials/upload',
          method: 'POST',
          status: 202,
          contentHash: result.payload.contentHash,
        });

        return NextResponse.json(result.payload, { status: 202 });
      } catch (err) {
        auditLog({
          event: 'upload_failed',
          route: 'materials/upload',
          method: 'POST',
          status: 500,
          reason: err.message,
        });
        return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
      }
    }
  );
}
