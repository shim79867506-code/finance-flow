import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { session } from "../../../lib/auth";

export async function GET(request: NextRequest) {
  const current = await session();
  if (!current) return new NextResponse(null, { status: 401 });
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get("id"));
  const org = z.uuid().safeParse(request.nextUrl.searchParams.get("org"));
  if (!id.success || !org.success)
    return new NextResponse(null, { status: 400 });
  const { data } = await current.db
    .from("upload_batches")
    .select("original_name,storage_path")
    .eq("org_id", org.data)
    .eq("id", id.data)
    .maybeSingle();
  if (!data) return new NextResponse(null, { status: 404 });
  const file = await current.db.storage
    .from("erp-originals")
    .createSignedUrl(data.storage_path, 60, { download: data.original_name });
  if (file.error) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(file.data.signedUrl, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
