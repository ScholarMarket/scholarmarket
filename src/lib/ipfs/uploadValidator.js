/**
 * Canonical upload validation.
 *
 * Validates uploaded file byte streams by inspecting magic numbers / file headers
 * before dispatching to Pinata (prevents malformed or spoofed files from being
 * pinned), and owns the shared file-type allowlists, size limits, and the
 * request-level `validateUploadRequest` used by the consolidated upload routes.
 * `src/lib/materials/uploadValidation.js` re-exports the constants from here so
 * every upload path (initial upload, revisions) shares one source of truth.
 */

import {
  validateUploadFileMetadata,
  validateUploadPayload,
} from "../api/validation.js";

// Magic number signatures keyed by MIME type
const SIGNATURES = {
  'application/pdf': [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  'application/zip': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK (local file header)
    { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // PK (empty archive)
  ],
  'application/x-zip-compressed': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
    { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] },
  ],
  // .doc / .xls / .ppt — Compound Document (OLE2) format
  'application/msword': [
    { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  'application/vnd.ms-excel': [
    { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  'application/vnd.ms-powerpoint': [
    { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  // .docx / .xlsx / .pptx — OOXML (ZIP-based)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  // Video formats
  'video/mp4': [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // ftyp box (standard ISO/MP4)
  ],
  // Images
  'image/jpeg': [
    { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  ],
  'image/png': [
    { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  'image/gif': [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF — verified alongside WEBP marker below
  ],
};

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_THUMBNAIL_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/** Allowed MIME types for the main document file. Shared by uploads + revisions. */
export const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
];

/** Allowed MIME types for the optional thumbnail image. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateFileSize(file, maxBytes = MAX_FILE_SIZE_BYTES) {
  if (!file || typeof file.size !== 'number') {
    return { valid: false, reason: 'Invalid file size metadata.' };
  }
  if (file.size > maxBytes) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const limitMB = (maxBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      reason: `File size (${sizeMB}MB) exceeds the maximum allowed limit of ${limitMB}MB.`,
    };
  }
  return { valid: true };
}

// WEBP requires an additional check at bytes 8–11
const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

// text/plain has no magic number; we validate it is valid UTF-8 with a heuristic check
const NULL_BYTE_THRESHOLD = 0.01; // >1% null bytes = likely binary

/**
 * Reads the first `n` bytes of a Web API File/Blob.
 * @param {File} file
 * @param {number} n
 * @returns {Promise<Uint8Array>}
 */
async function readHeader(file, n) {
  const slice = file.slice(0, n);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Checks whether `header` starts with `sig.bytes` at `sig.offset`.
 */
function matchesSignature(header, sig) {
  if (header.length < sig.offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => header[sig.offset + i] === b);
}

/**
 * Validates that the file's binary header matches the declared MIME type.
 *
 * @param {File} file - Web API File object (has .type and .slice)
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateFileMagicNumber(file) {
  const mimeType = (file.type || '').toLowerCase();

  // text/plain: heuristic — reject if more than 1% of sampled bytes are null
  if (mimeType === 'text/plain') {
    const sampleSize = Math.min(file.size, 4096);
    const header = await readHeader(file, sampleSize);
    const nullCount = header.reduce((acc, b) => acc + (b === 0x00 ? 1 : 0), 0);
    if (nullCount / header.length > NULL_BYTE_THRESHOLD) {
      return { valid: false, reason: 'File declared as text/plain but contains binary data.' };
    }
    return { valid: true };
  }

  // WEBP requires two separate checks
  if (mimeType === 'image/webp') {
    const header = await readHeader(file, 12);
    const hasRiff = matchesSignature(header, { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] });
    const hasWebp = WEBP_MARKER.every((b, i) => header[8 + i] === b);
    if (!hasRiff || !hasWebp) {
      return { valid: false, reason: 'File header does not match image/webp (expected RIFF….WEBP).' };
    }
    return { valid: true };
  }

  const sigs = SIGNATURES[mimeType];
  if (!sigs) {
    // Unknown / unregistered type — allow through; other validators handle allowlisting
    return { valid: true };
  }

  const maxSigLen = Math.max(...sigs.map(s => s.offset + s.bytes.length));
  const header = await readHeader(file, maxSigLen);

  const matched = sigs.some(sig => matchesSignature(header, sig));
  if (!matched) {
    return {
      valid: false,
      reason: `File header does not match declared MIME type "${mimeType}". The file may be corrupt or misidentified.`,
    };
  }

  return { valid: true };
}

/**
 * Validates both MIME type allowlist and magic number for a document file.
 *
 * @param {File} file
 * @param {string[]} allowedTypes - list of permitted MIME types
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateUploadedFile(file, allowedTypes) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return { valid: false, reason: 'Invalid file object.' };
  }

  const mimeType = (file.type || '').toLowerCase();

  if (!allowedTypes.includes(mimeType)) {
    return {
      valid: false,
      reason: `Unsupported file type: ${mimeType || 'unknown'}.`,
    };
  }

  return validateFileMagicNumber(file);
}

/**
 * Runs the full request-level validation for an upload: file presence, size,
 * MIME allowlist, magic-number signature, optional thumbnail, and the structured
 * metadata fields. Returns a structured result so the route can map it to an HTTP
 * response and an audit event without re-implementing the checks.
 *
 * @param {object} args
 * @param {File} [args.file] - main document file from FormData
 * @param {File} [args.image] - optional thumbnail from FormData
 * @param {FormData} args.form - the upload form (used for metadata fields)
 * @returns {Promise<{ valid: true } | { valid: false, status: number, reason: string, event: 'upload_failed'|'upload_blocked', auditReason: string }>}
 */
export async function validateUploadRequest({ file, image, form } = {}) {
  if (!file) {
    return {
      valid: false,
      status: 400,
      event: 'upload_failed',
      auditReason: 'missing_file',
      reason: 'No document file provided.',
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      status: 413,
      event: 'upload_failed',
      auditReason: 'file_too_large',
      reason: `File size (${sizeMB}MB) exceeds the 10MB limit.`,
    };
  }

  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return {
      valid: false,
      status: 415,
      event: 'upload_failed',
      auditReason: 'unsupported_file_type',
      reason: `Unsupported file type: ${file.type || 'unknown'}. Allowed types include PDF, Word, Excel, PPT, TXT, and ZIP.`,
    };
  }

  const fileCheck = await validateUploadedFile(file, ALLOWED_FILE_TYPES);
  if (!fileCheck.valid) {
    return {
      valid: false,
      status: 422,
      event: 'upload_blocked',
      auditReason: fileCheck.reason,
      reason: fileCheck.reason,
    };
  }

  if (image) {
    if (image.size > MAX_THUMBNAIL_SIZE_BYTES) {
      const sizeMB = (image.size / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        status: 413,
        event: 'upload_failed',
        auditReason: 'thumbnail_too_large',
        reason: `Thumbnail size (${sizeMB}MB) exceeds the 5MB limit.`,
      };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
      return {
        valid: false,
        status: 415,
        event: 'upload_failed',
        auditReason: 'unsupported_thumbnail_type',
        reason: `Unsupported thumbnail type: ${image.type || 'unknown'}. Allowed types are JPG, PNG, and WEBP.`,
      };
    }
    const imageCheck = await validateUploadedFile(image, ALLOWED_IMAGE_TYPES);
    if (!imageCheck.valid) {
      return {
        valid: false,
        status: 422,
        event: 'upload_blocked',
        auditReason: imageCheck.reason,
        reason: imageCheck.reason,
      };
    }
  }

  try {
    validateUploadFileMetadata(file, 'file');
  } catch (validationErr) {
    return {
      valid: false,
      status: 400,
      event: 'upload_failed',
      auditReason: validationErr.message,
      reason: validationErr.message,
    };
  }

  const metadataPayload = {
    title: form?.get('title') || form?.get('name'),
    description: form?.get('description'),
    price: form?.get('price'),
    usageRights: form?.get('usageRights'),
    visibility: form?.get('visibility'),
  };

  try {
    validateUploadPayload(metadataPayload);
  } catch (validationErr) {
    return {
      valid: false,
      status: 400,
      event: 'upload_failed',
      auditReason: validationErr.message,
      reason: validationErr.message,
    };
  }

  return { valid: true };
}
