/**
 * File constraints shared by initial uploads and revision uploads.
 *
 * The canonical source of truth is `src/lib/ipfs/uploadValidator.js`; this module
 * re-exports the shared limits and allowlists so existing consumers (the
 * revisions route, etc.) keep importing from `@/lib/materials/uploadValidation`
 * while validation is unified in one place.
 */
export {
  MAX_FILE_SIZE_BYTES,
  MAX_THUMBNAIL_SIZE_BYTES,
  ALLOWED_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
} from "../ipfs/uploadValidator.js";
