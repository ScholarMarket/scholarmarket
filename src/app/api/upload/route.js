/**
 * POST /api/upload — DEPRECATED legacy upload endpoint.
 *
 * Behavioural differences with the canonical `/api/materials/upload` route, for
 * the record (issue #167):
 *   - Validation limits/types: this route allowed 50MB and video/mp4 + GIF;
 *     the canonical route enforces the shared limits and allowlist. Unifying
 *     validation in src/lib/ipfs/uploadValidator.js means this route now uses
 *     the canonical (stricter) policy too.
 *   - Pinning: this route pinned a metadata JSON and returned its gateway URL
 *     plus a `storageKey`; the canonical route pins the file, thumbnail and
 *     metadata JSON (so the metadata URL contract is preserved) and returns the
 *     file CID as `storageKey` (this also fixes the legacy bug where `storageKey`
 *     was never assigned).
 *   - Persistence: this route only invalidated the marketplace cache (and had a
 *     dead, unreachable pending_pins fallback); the canonical route persists a
 *     quarantine record and enqueues a content scan. After consolidation both
 *     routes go through the quarantine flow.
 *
 * This handler is a thin deprecated wrapper: it delegates to the canonical
 * handler and signals deprecation via response headers. New clients must call
 * `/api/materials/upload`.
 */

import { POST as canonicalUpload } from "../materials/upload/route";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const response = await canonicalUpload(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", "Fri, 31 Dec 2027 23:59:59 GMT");
  response.headers.set("Link", '</api/materials/upload>; rel="successor-version"');
  return response;
}
