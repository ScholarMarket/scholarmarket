import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pinata } from "@/lib/pinata";
import {
  ALLOWED_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_THUMBNAIL_SIZE_BYTES,
  validateUploadedFile,
} from "@/lib/ipfs/uploadValidator";

const SIGNED_URL_TTL_SECONDS = 60;

function secret() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET not configured");
  return process.env.JWT_SECRET;
}

export function validateUploadDescriptor({ name, mimeType, size, kind = "material" }) {
  const allowedTypes = kind === "thumbnail" ? ALLOWED_IMAGE_TYPES : ALLOWED_FILE_TYPES;
  const maxSize = kind === "thumbnail" ? MAX_THUMBNAIL_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
  if (typeof name !== "string" || !name.trim() || name.length > 255) throw new Error("Invalid file name");
  if (!allowedTypes.includes(mimeType)) throw new Error("Unsupported file type");
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxSize) throw new Error(`File exceeds the ${maxSize / 1024 / 1024}MB limit`);
  return { name: name.trim(), mimeType, size, kind };
}

export async function createDirectUpload(descriptor, uploader) {
  const uploadId = crypto.randomUUID();
  const url = await pinata.upload.public.createSignedURL({
    expires: SIGNED_URL_TTL_SECONDS,
    name: descriptor.name,
    mimeTypes: [descriptor.mimeType],
    maxFileSize: descriptor.size,
    keyvalues: { scholarmarketUploadId: uploadId },
  });
  const token = jwt.sign({ ...descriptor, uploader: uploader.toLowerCase(), uploadId }, secret(), {
    algorithm: "HS256",
    expiresIn: SIGNED_URL_TTL_SECONDS * 2,
  });
  return { url, token, expiresIn: SIGNED_URL_TTL_SECONDS };
}

function readUploadToken(token, uploader, kind) {
  const payload = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  if (payload.uploader !== uploader.toLowerCase() || payload.kind !== kind) throw new Error("Upload token does not match this request");
  return validateUploadDescriptor(payload);
}

async function headerFile(url, descriptor) {
  const response = await fetch(url, { headers: { Range: "bytes=0-4095" }, cache: "no-store" });
  if (!response.ok) throw new Error("Unable to inspect pinned file");
  const header = new Uint8Array(await response.arrayBuffer());
  return {
    name: descriptor.name,
    type: descriptor.mimeType,
    size: descriptor.size,
    arrayBuffer: async () => header.buffer,
    slice: (start, end) => ({ arrayBuffer: async () => header.slice(start, end).buffer }),
  };
}

export async function verifyDirectUpload({ cid, token, uploader, kind = "material" }) {
  if (typeof cid !== "string" || cid.length < 20 || cid.length > 128) throw new Error("Invalid CID");
  const descriptor = readUploadToken(token, uploader, kind);
  const result = await pinata.files.public.list().cid(cid).limit(2);
  const pinned = result.files?.find(file => file.cid === cid);
  if (!pinned) throw new Error("Pinned file not found");
  const size = Number(pinned.size);
  const mimeType = pinned.mimeType || pinned.mime_type;
  if (size !== descriptor.size || mimeType !== descriptor.mimeType) throw new Error("Pinned file size or type does not match the declared upload");
  const url = await pinata.gateways.public.convert(cid);
  const validation = await validateUploadedFile(await headerFile(url, descriptor), kind === "thumbnail" ? ALLOWED_IMAGE_TYPES : ALLOWED_FILE_TYPES);
  if (!validation.valid) throw new Error(validation.reason);
  return { ...descriptor, type: descriptor.mimeType, cid, url };
}
