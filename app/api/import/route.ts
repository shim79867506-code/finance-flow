import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { session } from "../../../lib/auth";
import { catalog, membership } from "../../../lib/data";
import { keys, maxBytes, validate, type Field } from "../../../lib/ledger";
import { mappedRows, readSheets } from "../../../lib/workbook";

export const runtime = "nodejs";
const reply = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
export async function POST(request: Request) {
  const current = await session();
  if (!current) return reply("로그인이 필요합니다.", 401);
  try {
    if (Number(request.headers.get("content-length")) > maxBytes + 8192)
      return reply("파일 크기 제한을 초과했습니다.", 413);
    const form = await request.formData();
    const parsed = z.uuid().safeParse(form.get("org"));
    const file = form.get("file");
    if (
      !parsed.success ||
      !(file instanceof File) ||
      file.size > maxBytes ||
      file.name.length > 255
    )
      return reply("파일 또는 조직 정보를 확인하세요.");
    const org = parsed.data;
    const member = await membership(current.db, current.user.id, org);
    if (!member || member.role === "auditor")
      return reply("업로드 권한이 없습니다.", 403);
    const bytes = await file.arrayBuffer();
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const duplicate = await current.db
      .from("upload_batches")
      .select("id")
      .eq("org_id", org)
      .eq("sha256", hash)
      .maybeSingle();
    if (duplicate.error) return reply("업로드 이력을 확인할 수 없습니다.", 503);
    if (duplicate.data) return reply("이미 등록된 파일입니다.", 409);

    let columns: Record<Field, number>;
    let sheetName: string;
    let rows;
    try {
      const input = JSON.parse(String(form.get("columns")));
      if (
        !input ||
        !keys.every((key) => Number.isInteger(input[key]) && input[key] >= -1)
      )
        return reply("컬럼 매핑을 확인하세요.");
      columns = Object.fromEntries(
        keys.map((key) => [key, input[key]]),
      ) as Record<Field, number>;
      const sheet = (await readSheets(file.name, bytes))[
        Number(form.get("sheet"))
      ];
      if (!sheet) return reply("시트를 확인하세요.");
      sheetName = sheet.name;
      rows = mappedRows(sheet, columns);
    } catch (error) {
      return reply(
        error instanceof Error ? error.message : "파일을 읽을 수 없습니다.",
      );
    }
    const { accounts, projects } = await catalog(current.db, org);
    const checked = validate(rows, accounts, projects);
    if (checked.errors.length)
      return NextResponse.json(
        { error: "파일 검증에 실패했습니다.", rows: checked.errors },
        { status: 422 },
      );

    const id = randomUUID();
    const result = await current.db.storage
      .from("erp-originals")
      .upload(org + "/" + id, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (result.error) return reply("원본 파일 보관에 실패했습니다.", 503);
    const saved = await current.db.rpc("import_erp", {
      p_org: org,
      p_id: id,
      p_sha: hash,
      p_name: file.name,
      p_sheet: sheetName,
      p_map: columns,
      p_lines: checked.lines,
    });
    if (saved.error) {
      const message =
        saved.error.code === "23505"
          ? "이미 저장된 전표가 있습니다."
          : saved.error.message === "마감된 회계기간입니다."
            ? saved.error.message
            : "전표 저장에 실패했습니다. 등록된 계정과 기간을 확인하세요.";
      return reply(message, saved.error.code === "23505" ? 409 : 422);
    }
    if (saved.data !== id) return reply("이미 등록된 파일입니다.", 409);
    return NextResponse.json({ id });
  } catch {
    return reply("업로드를 처리하는 중 오류가 발생했습니다.", 500);
  }
}
