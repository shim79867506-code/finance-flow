import DecimalJs from "decimal.js";
import { z } from "zod";

export const Decimal = DecimalJs.clone({ precision: 48 });
export const groups = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
  "other",
] as const;
export type Group = (typeof groups)[number];
export type Account = { code: string; name: string; kind: Group };
export type Project = { code: string; name: string };
export const maxRows = 5000;
export const maxBytes = 4 * 1024 * 1024;

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(value);
  return !isNaN(+date) && date.toISOString().slice(0, 10) === value;
}

const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/, "금액 형식 또는 범위 오류");
export const fields = {
  date: "회계일자",
  entry_no: "전표번호",
  account_code: "계정코드",
  debit: "차변",
  credit: "대변",
  project_code: "프로젝트코드",
  division: "사업부",
  memo: "적요",
  vendor: "거래처",
};
export type Field = keyof typeof fields;
export const keys = Object.keys(fields) as Field[];
export const required = new Set<Field>(keys.slice(0, 6));
export const lineSchema = z.object({
  date: z.string().refine(validDate, "날짜 형식 오류"),
  entry_no: z.string().min(1, "전표번호 누락").max(100),
  account_code: z.string().min(1, "계정코드 누락").max(100),
  debit: amount,
  credit: amount,
  project_code: z.string().min(1, "프로젝트코드 누락").max(100),
  division: z.string().max(100),
  memo: z.string().max(1000),
  vendor: z.string().max(200),
});
export type Line = z.infer<typeof lineSchema>;
export type LedgerLine = Line & { id: string; reviewed: boolean };
export type RowError = { row: number; reason: string };
export const entryKey = (line: Pick<Line, "date" | "entry_no">) =>
  JSON.stringify([line.date, line.entry_no]);
export const t = (value: DecimalJs.Value) => new Decimal(value);
export function money(value: DecimalJs.Value) {
  const amount = t(value);
  const [integer, cents] = amount
    .toFixed(amount.isInteger() ? 0 : 2)
    .split(".");
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents ? formatted + "." + cents : formatted;
}
export const profit = (totals: Record<Group, DecimalJs>) =>
  totals.revenue.minus(totals.cogs).minus(totals.expense);
export const margin = (value: DecimalJs, sales: DecimalJs) =>
  sales.isZero() ? null : value.div(sales).mul(100);
export const change = (current: DecimalJs, previous: DecimalJs) =>
  previous.isZero()
    ? null
    : current.minus(previous).div(previous.abs()).mul(100);

export function sums(lines: Pick<Line, "debit" | "credit">[]) {
  return lines.reduce(
    (a, row) => ({
      debit: a.debit.plus(row.debit),
      credit: a.credit.plus(row.credit),
    }),
    { debit: t(0), credit: t(0) },
  );
}

export function summarize(lines: Line[], accounts: Account[]) {
  const map = new Map(accounts.map((a) => [a.code, a.kind]));
  const totals = Object.fromEntries(
    groups.map((group) => [group, t(0)]),
  ) as Record<Group, DecimalJs>;
  for (const line of lines) {
    const group = map.get(line.account_code);
    if (!group) continue;
    const net = t(line.debit).minus(line.credit);
    totals[group] = totals[group].plus(
      ["revenue", "liability", "equity"].includes(group) ? net.neg() : net,
    );
  }
  return totals;
}

export function validate(
  lines: { row: number; data: unknown }[],
  accounts: Account[],
  projects: Project[],
  existing: Line[] = [],
) {
  const accountCodes = new Set(accounts.map((a) => a.code));
  const projectCodes = new Set(projects.map((p) => p.code));
  const duplicates = new Set(existing.map(entryKey));
  const errors: RowError[] = [];
  const valid: Line[] = [];
  const entries = new Map<string, { line: Line; row: number }[]>();
  if (!lines.length || lines.length > maxRows)
    errors.push({ row: 0, reason: `데이터는 1~${maxRows}행이어야 합니다.` });
  for (const { row, data } of lines) {
    const parsed = lineSchema.safeParse(data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({
          row,
          reason: `${fields[issue.path[0] as Field]} · ${issue.message}`,
        });
      continue;
    }
    const line = parsed.data;
    if (!accountCodes.has(line.account_code))
      errors.push({ row, reason: "계정과목 미매핑" });
    if (!projectCodes.has(line.project_code))
      errors.push({ row, reason: "등록되지 않은 프로젝트 코드" });
    if (t(line.debit).isZero() === t(line.credit).isZero())
      errors.push({
        row,
        reason: "차변 또는 대변 한쪽에만 금액을 입력하세요.",
      });
    const key = entryKey(line);
    if (duplicates.has(key)) errors.push({ row, reason: "이미 저장된 전표" });
    const entry = entries.get(key) ?? [];
    entry.push({ line, row });
    entries.set(key, entry);
    valid.push(line);
  }
  for (const entry of entries.values()) {
    const total = sums(entry.map((item) => item.line));
    if (!total.debit.eq(total.credit))
      errors.push({
        row: entry[0].row,
        reason: `전표 ${entry[0].line.entry_no} 차대변 불일치`,
      });
  }
  return { errors, lines: valid, totals: sums(valid) };
}
