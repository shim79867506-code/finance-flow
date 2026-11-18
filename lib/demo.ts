import { type Account, type Project, type LedgerLine } from "./ledger";

export const demoAccounts: Account[] = [
  { code: "101", name: "현금 및 현금성자산", kind: "asset" },
  { code: "201", name: "미지급금", kind: "liability" },
  { code: "301", name: "자본금", kind: "equity" },
  { code: "401", name: "제품 매출", kind: "revenue" },
  { code: "501", name: "프로젝트 원가", kind: "cogs" },
  { code: "601", name: "판매비와관리비", kind: "expense" },
];
export const demoProjects: Project[] = [
  { code: "P001", name: "클라우드 전환" },
  { code: "P002", name: "운영 자동화" },
  { code: "P003", name: "서비스 플랫폼" },
  { code: "COMMON", name: "공통" },
];

export function sampleLedger(year: number): LedgerLine[] {
  const rows: LedgerLine[] = [];
  for (const y of [year - 1, year]) {
    for (let m = 1; m <= 12; m++) {
      for (const [p, project] of demoProjects.slice(0, 3).entries()) {
        const date = `${y}-${String(m).padStart(2, "0")}-15`;
        const division = p === 1 ? "운영사업부" : "디지털사업부";
        const revenue =
          ((62000000 + 2900000 * m + (m % 3) * 8900000 - p * 13000000) *
            (y === year ? 100 : 87)) /
          100;
        const entries = [
          ["101", "401", revenue, "프로젝트 매출"],
          [
            "501",
            "201",
            Math.round((revenue * (54 + p * 2)) / 100),
            "프로젝트 원가",
          ],
          ["601", "101", Math.round((revenue * 18) / 100), "운영비 집행"],
          ["101", "301", m === 1 ? 170000000 : 0, "자본 납입"],
        ] as const;
        for (const [i, [debit, credit, value, memo]] of entries.entries()) {
          if (!value) continue;
          const entry_no = `DEMO-${y}${String(m).padStart(2, "0")}-${p + 1}${i + 1}`;
          const base = {
            date,
            entry_no,
            memo,
            division,
            project_code: project.code,
            vendor: "샘플 거래처",
            reviewed: m % 3 === 0,
          };
          rows.push(
            {
              ...base,
              id: entry_no + "-D",
              account_code: debit,
              debit: String(value),
              credit: "0",
            },
            {
              ...base,
              id: entry_no + "-C",
              account_code: credit,
              debit: "0",
              credit: String(value),
            },
          );
        }
      }
    }
  }
  return rows;
}
