import { NextResponse } from "next/server";
import { getUserFromCookie } from "@/lib/api/auth";
import { withApiHardening } from "@/lib/api/hardening";
import { validateUploadPayload } from "@/lib/api/validation";
import { verifyDirectUpload } from "@/lib/ipfs/directUpload";
import { finalizeDirectUpload } from "@/lib/ipfs/uploadService";

export const runtime = "nodejs";

export async function POST(request) {
  return withApiHardening(request, { route: "material-upload-finalize", rateLimit: { limit: 20, windowMs: 60_000 } }, async () => {
    const user = await getUserFromCookie(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const body = await request.json();
      const uploader = user.walletAddress || user.address;
      if (!uploader) return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
      validateUploadPayload(body.fields);
      const file = await verifyDirectUpload({ cid: body.cid, token: body.token, uploader });
      const image = body.thumbnailCid
        ? await verifyDirectUpload({ cid: body.thumbnailCid, token: body.thumbnailToken, uploader, kind: "thumbnail" })
        : null;
      return NextResponse.json(await finalizeDirectUpload({ file, image, fields: body.fields, uploaderAddress: uploader }));
    } catch (error) {
      return NextResponse.json({ error: error.message || "Unable to finalize upload" }, { status: 422 });
    }
  });
}
