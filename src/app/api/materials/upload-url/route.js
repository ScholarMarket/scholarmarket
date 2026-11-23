import { NextResponse } from "next/server";
import { getUserFromCookie } from "@/lib/api/auth";
import { withApiHardening } from "@/lib/api/hardening";
import { createDirectUpload, validateUploadDescriptor } from "@/lib/ipfs/directUpload";

export const runtime = "nodejs";

export async function POST(request) {
  return withApiHardening(request, { route: "material-upload-url", rateLimit: { limit: 20, windowMs: 60_000 } }, async () => {
    const user = await getUserFromCookie(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const descriptor = validateUploadDescriptor(await request.json());
      const uploader = user.walletAddress || user.address;
      if (!uploader) return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
      return NextResponse.json(await createDirectUpload(descriptor, uploader));
    } catch (error) {
      return NextResponse.json({ error: error.message || "Invalid upload request" }, { status: 400 });
    }
  });
}
