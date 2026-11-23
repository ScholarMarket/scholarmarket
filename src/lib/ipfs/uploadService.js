import { pinata } from "@/lib/pinata";
import {
  validatePinataResponse,
  validateGatewayUrl,
  retryWithBackoff,
} from "@/lib/api/storage";
import { logger } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { createQuarantineRecord } from "@/lib/publishing/quarantine";
import { enqueueSideEffect } from "@/lib/backend/outbox";
import { sanitizeObject, normalizeStringList } from "@/lib/api/validation";
import { validateUploadRequest } from "@/lib/ipfs/uploadValidator";

/**
 * Shared upload pipeline: validate -> pin -> persist.
 *
 * Both upload routes delegate here so validation, Pinata pinning and
 * persistence live in one place (fixes no longer land in one route but not the
 * other). The canonical route (`/api/materials/upload`) calls `processUpload`
 * directly; the legacy route (`/api/upload`) is a thin deprecated wrapper that
 * delegates to the canonical handler.
 *
 * `processUpload` returns a structured result the route maps to an HTTP response
 * and an audit event. It is the only function here that touches Pinata and the
 * database, which keeps the routes thin and the pipeline unit-testable.
 */

const PIN_RETRIES = 3;
const PIN_DELAY_MS = 1000;

function retryWarn(label) {
  return (err, attempt) => {
    logger.warn(`[Storage] ${label} attempt ${attempt} failed: ${err.message}`);
  };
}

/**
 * Builds the IPFS metadata JSON pinned alongside the file. Mirrors the shape
 * previously produced by the legacy `/api/upload` route so downstream consumers
 * (the mint step, the material record) keep the same `metadata` URL contract.
 */
function buildMetadataJSON({ form, storageKey, fileUrl, imgUrl }) {
  const otherFields = {};
  for (const [key, value] of form.entries()) {
    if (key !== "file" && key !== "thumbnail") {
      otherFields[key] = value;
    }
  }

  const previewInputs = {
    learningOutcomes: otherFields.learningOutcomes,
    tableOfContents: otherFields.tableOfContents,
    sampleNotes: otherFields.sampleNotes,
  };

  const scalarFields = { ...otherFields };
  delete scalarFields.learningOutcomes;
  delete scalarFields.tableOfContents;
  delete scalarFields.sampleNotes;

  const sanitizedScalarFields = sanitizeObject(scalarFields, {
    title: 160,
    description: 5000,
    shortSummary: 280,
    usageRights: 1000,
    coverImageUrl: 2048,
    thumbnailUrl: 2048,
  });

  const image = imgUrl || null;
  const timestamp = new Date().toISOString();

  return {
    name: sanitizedScalarFields.title || sanitizedScalarFields.name || "",
    description: sanitizedScalarFields.description || "",
    image,
    properties: {
      ...sanitizedScalarFields,
      coverImageUrl: image || sanitizedScalarFields.coverImageUrl || null,
      thumbnailUrl: image || sanitizedScalarFields.thumbnailUrl || null,
      learningOutcomes: normalizeStringList(previewInputs.learningOutcomes, {
        maxItems: 8,
        maxLength: 180,
      }),
      tableOfContents: normalizeStringList(previewInputs.tableOfContents, {
        maxItems: 16,
        maxLength: 180,
      }),
      sampleNotes: normalizeStringList(previewInputs.sampleNotes, {
        maxItems: 6,
        maxLength: 280,
      }),
      storageKey,
      fileUrl,
      timestamp,
    },
    ...sanitizedScalarFields,
    coverImageUrl: image || sanitizedScalarFields.coverImageUrl || null,
    thumbnailUrl: image || sanitizedScalarFields.thumbnailUrl || null,
    learningOutcomes: normalizeStringList(previewInputs.learningOutcomes, {
      maxItems: 8,
      maxLength: 180,
    }),
    tableOfContents: normalizeStringList(previewInputs.tableOfContents, {
      maxItems: 16,
      maxLength: 180,
    }),
    sampleNotes: normalizeStringList(previewInputs.sampleNotes, {
      maxItems: 6,
      maxLength: 280,
    }),
    storageKey,
    fileUrl,
    image,
    timestamp,
  };
}

export async function finalizeDirectUpload({ file, image, fields, uploaderAddress }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  const metadataJSON = buildMetadataJSON({ form, storageKey: file.cid, fileUrl: file.url, imgUrl: image?.url || null });
  const metadataUrl = await pinMetadata(metadataJSON);
  const db = await getDb();
  const quarantine = await persistQuarantine({
    db,
    storageKey: file.cid,
    file,
    title: file.name,
    uploaderAddress,
  });
  return {
    success: true,
    status: "quarantined",
    storageKey: file.cid,
    contentHash: quarantine.contentHash,
    image: image?.url || "",
    metadata: metadataUrl,
    quarantineState: quarantine.state,
  };
}

async function pinFile(file) {
  const uploaded = await retryWithBackoff(
    () => pinata.upload.public.file(file),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Document upload")
  );
  validatePinataResponse(uploaded, "document");
  const url = await retryWithBackoff(
    () => pinata.gateways.public.convert(uploaded.cid),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Document gateway conversion")
  );
  validateGatewayUrl(url, "document");
  return { cid: uploaded.cid, url };
}

async function pinImage(image) {
  const uploaded = await retryWithBackoff(
    () => pinata.upload.public.file(image),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Thumbnail upload")
  );
  validatePinataResponse(uploaded, "thumbnail");
  const url = await retryWithBackoff(
    () => pinata.gateways.public.convert(uploaded.cid),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Thumbnail gateway conversion")
  );
  validateGatewayUrl(url, "thumbnail");
  return url;
}

async function pinMetadata(metadataJSON) {
  const uploaded = await retryWithBackoff(
    () => pinata.upload.public.json(metadataJSON),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Metadata upload")
  );
  validatePinataResponse(uploaded, "metadata");
  const url = await retryWithBackoff(
    () => pinata.gateways.public.convert(uploaded.cid),
    PIN_RETRIES,
    PIN_DELAY_MS,
    retryWarn("Metadata gateway conversion")
  );
  validateGatewayUrl(url, "metadata");
  return url;
}

async function persistQuarantine({ db, storageKey, file, title, uploaderAddress }) {
  const quarantine = await createQuarantineRecord({
    db,
    contentHash: storageKey,
    fileName: title,
    mimeType: file.type,
    sizeBytes: file.size,
    uploaderAddress,
    materialId: null,
  });

  await enqueueSideEffect({
    sourceAggregate: "quarantine",
    sourceId: quarantine.contentHash,
    intent: {
      type: "indexer",
      channel: "scan_content",
      payload: {
        contentHash: quarantine.contentHash,
        fileName: quarantine.fileName,
        mimeType: quarantine.mimeType,
        sizeBytes: quarantine.sizeBytes,
        action: "scan",
      },
    },
  });

  return quarantine;
}

function failure(status, reason, auditReason) {
  return { ok: false, status, reason, event: "upload_failed", auditReason };
}

/**
 * Runs the consolidated upload pipeline.
 *
 * @param {object} args
 * @param {File} args.file - main document file from FormData
 * @param {File} [args.image] - optional thumbnail from FormData
 * @param {FormData} args.form - the upload form (metadata fields + lists)
 * @param {string} [args.uploaderAddress] - creator wallet address
 * @returns {Promise<object>} `{ ok, payload }` on success or `{ ok: false, status, reason, event, auditReason }` on failure
 */
export async function processUpload({ file, image, form, uploaderAddress = "anonymous" }) {
  const validation = await validateUploadRequest({ file, image, form });
  if (!validation.valid) {
    return {
      ok: false,
      status: validation.status,
      reason: validation.reason,
      event: validation.event,
      auditReason: validation.auditReason,
    };
  }

  let filePin;
  try {
    filePin = await pinFile(file);
  } catch (err) {
    return failure(
      500,
      `Failed to upload document to storage: ${err.message}`,
      `document_upload_failure: ${err.message}`
    );
  }

  let imgUrl = null;
  if (image) {
    try {
      imgUrl = await pinImage(image);
    } catch (err) {
      return failure(
        500,
        `Failed to upload thumbnail to storage: ${err.message}`,
        `thumbnail_upload_failure: ${err.message}`
      );
    }
  }

  let metadataUrl;
  try {
    const metadataJSON = buildMetadataJSON({
      form,
      storageKey: filePin.cid,
      fileUrl: filePin.url,
      imgUrl,
    });
    metadataUrl = await pinMetadata(metadataJSON);
  } catch (err) {
    return failure(
      500,
      `Failed to publish metadata to storage: ${err.message}`,
      `metadata_upload_failure: ${err.message}`
    );
  }

  let quarantine;
  try {
    const db = await getDb();
    const title = form.get("title") || form.get("name") || "Untitled Material";
    quarantine = await persistQuarantine({
      db,
      storageKey: filePin.cid,
      file,
      title,
      uploaderAddress,
    });
  } catch (err) {
    return failure(
      500,
      `Failed to persist upload record: ${err.message}`,
      `quarantine_failure: ${err.message}`
    );
  }

  return {
    ok: true,
    payload: {
      success: true,
      status: "quarantined",
      storageKey: filePin.cid,
      contentHash: quarantine.contentHash,
      image: imgUrl || "",
      metadata: metadataUrl,
    },
  };
}
