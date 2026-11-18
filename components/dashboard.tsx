"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  CloudUpload,
  FileCheck2,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  entryKey,
  type Group,
  type LedgerLine,
  type Line,
} from "../lib/ledger";
import type { Workspace } from "../lib/data";
import { logout } from "../app/actions";
import { Brand } from "./access";
import { Button, Empty, Panel } from "./ui";

const Overview = dynamic(() => import("./overview").then((m) => m.Overview));
const Vouchers = dynamic(() => import("./vouchers").then((m) => m.Vouchers));
const Upload = dynamic(() => import("./upload").then((m) => m.Upload));
const Projects = dynamic(() => import("./projects").then((m) => m.Projects));
const Settings = dynamic(() => import("./settings").then((m) => m.Settings));
const nav = [
  { key: "overview", label: "대시보드", icon: LayoutDashboard, live: true },
  { key: "vouchers", label: "전표 관리", icon: BookOpen, live: true },
  { key: "statements", label: "재무제표", icon: BarChart3, live: false },
  { key: "projects", label: "사업별 손익", icon: FolderOpen, live: true },
  { key: "closing", label: "결산 관리", icon: ClipboardCheck, live: false },
  { key: "expenses", label: "기간비용 관리", icon: CalendarDays, live: false },
  { key: "audit", label: "감사 대응", icon: ShieldCheck, live: false },
  { key: "upload", label: "데이터 업로드", icon: CloudUpload, live: true },
  { key: "settings", label: "시스템 설정", icon: Settings2, live: true },
] as const;
type Page = (typeof nav)[number]["key"];
const roleName = {
  admin: "관리자",
  accountant: "회계 담당자",
  auditor: "감사 조회자",
};
const monthText = (n: number) => String(n).padStart(2, "0");
const periods = [
  { id: "annual", label: "연간", start: 1, end: 12 },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: monthText(i + 1),
    label: `${i + 1}월`,
    start: i + 1,
    end: i + 1,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `q${i + 1}`,
    label: `${i + 1}분기`,
    start: i * 3 + 1,
    end: i * 3 + 3,
  })),
  { id: "h1", label: "상반기", start: 1, end: 6 },
  { id: "h2", label: "하반기", start: 7, end: 12 },
];
const storageKey = "financeflow-demo-v1";
type Local = Pick<Workspace, "accounts" | "projects"> & {
  entries: LedgerLine[];
  reviewed: string[];
};

function readPage(): Page {
  const hash = location.hash.slice(1);
  return nav.find((item) => item.live && item.key === hash)?.key ?? "overview";
}

export function Dashboard({
  initial,
  demo = false,
  year,
}: {
  initial: Workspace;
  demo?: boolean;
  year: number;
}) {
  const router = useRouter();
  const [page, setPage] = useState<Page>("overview");
  const [open, setOpen] = useState(false);
  const [selectedYear, setYear] = useState(year);
  const [period, setPeriod] = useState("annual");
  const [division, setDivision] = useState("");
  const [project, setProject] = useState("");
  const [account, setAccount] = useState("");
  const [local, setLocal] = useState<Local>(() => ({
    accounts: initial.accounts,
    projects: initial.projects,
    entries: [],
    reviewed: [],
  }));
  useEffect(() => {
    const update = () => setPage(readPage());
    update();
    window.addEventListener("hashchange", update);
    if (demo) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) setLocal(JSON.parse(stored));
      } catch {
        /* A new browser-local demo is used when storage is unavailable. */
      }
    }
    return () => window.removeEventListener("hashchange", update);
  }, [demo]);
  const data = demo
    ? { ...initial, accounts: local.accounts, projects: local.projects }
    : initial;
  const ledger = useMemo(
    () =>
      demo
        ? [...initial.ledger, ...local.entries].map((r) =>
            local.reviewed.includes(entryKey(r)) ? { ...r, reviewed: true } : r,
          )
        : initial.ledger,
    [demo, initial.ledger, local.entries, local.reviewed],
  );
  const years = useMemo(
    () =>
      [
        ...new Set([
          year,
          year - 1,
          ...ledger.map((row) => Number(row.date.slice(0, 4))),
        ]),
      ].sort((a, b) => b - a),
    [year, ledger],
  );
  const divisions = useMemo(
    () =>
      [...new Set(ledger.map((row) => row.division).filter(Boolean))].sort(),
    [ledger],
  );
  const range = periods.find((p) => p.id === period) ?? periods[0];
  const scope = useMemo(() => {
    const current: LedgerLine[] = [],
      previous: LedgerLine[] = [],
      balances: LedgerLine[] = [],
      previousBalances: LedgerLine[] = [];
    const last = `${selectedYear}-${monthText(range.end)}`,
      prevLast = `${selectedYear - 1}-${monthText(range.end)}`;
    for (const row of ledger) {
      if (
        (division && row.division !== division) ||
        (project && row.project_code !== project)
      )
        continue;
      const ym = row.date.slice(0, 7);
      if (ym <= last) balances.push(row);
      if (ym <= prevLast) previousBalances.push(row);
      if (ym >= `${selectedYear}-${monthText(range.start)}` && ym <= last)
        current.push(row);
      if (
        ym >= `${selectedYear - 1}-${monthText(range.start)}` &&
        ym <= prevLast
      )
        previous.push(row);
    }
    return { current, previous, balances, previousBalances };
  }, [ledger, division, project, selectedYear, range]);
  const writable = initial.role !== "auditor";
  const go = (next: Page) => {
    setPage(next);
    setOpen(false);
    location.hash = next;
  };
  const drill = (
    field: "month" | "project" | "division" | "account",
    value: string,
  ) => {
    if (field === "month") setPeriod(value);
    if (field === "project") setProject(value);
    if (field === "division") setDivision(value);
    setAccount(field === "account" ? value : "");
    go("vouchers");
  };
  const store = (value: Local) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
    setLocal(value);
  };
  async function mutation(payload: Record<string, string>) {
    const result = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org: initial.org, ...payload }),
    });
    if (!result.ok)
      throw new Error((await result.json()).error ?? "저장에 실패했습니다.");
    router.refresh();
  }
  const current = nav.find((item) => item.key === page)!;
  return (
    <div className="shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Brand />
        <div className="workspace">
          <span>
            <Building2 size={16} />
          </span>
          <strong title={data.name}>
            {data.name}
            <small>{roleName[data.role]}</small>
          </strong>
        </div>
        <nav aria-label="주 메뉴">
          {nav
            .filter((item) => item.key !== "upload" || writable)
            .map(({ key, label, icon: Icon, live }) =>
              live ? (
                <a
                  key={key}
                  href={"#" + key}
                  aria-current={page === key ? "page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    setPage(key);
                    if (key === "vouchers") setAccount("");
                  }}
                >
                  <Icon size={17} />
                  {label}
                </a>
              ) : (
                <span key={key} className="inactive">
                  <Icon size={17} />
                  {label}
                  <small>예정</small>
                </span>
              ),
            )}
        </nav>
        <div className="sidebar-end">
          <FileCheck2 size={15} />
          재무회계 워크스페이스
        </div>
      </aside>
      {open && (
        <button
          className="overlay"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="crumb">
            <Button
              className="menu-toggle"
              aria-label="메뉴 열기"
              onClick={() => setOpen(!open)}
            >
              <Menu size={19} />
            </Button>
            <span>워크스페이스</span>
            <ChevronDown size={13} />
            <strong>{current.label}</strong>
          </div>
          <div className="profile">
            <span className="avatar">
              {data.email.slice(0, 1).toUpperCase() || "F"}
            </span>
            <span className="profile-name">
              {data.email}
              <small>{roleName[data.role]}</small>
            </span>
            {!demo && (
              <form action={logout}>
                <Button variant="quiet" aria-label="로그아웃">
                  <LogOut size={17} />
                </Button>
              </form>
            )}
          </div>
        </header>
        <main className="content">
          {demo && (
            <div className="demo-label">
              데모 모드 · 샘플 데이터와 브라우저 저장소 사용
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>{page === "overview" ? "재무 대시보드" : current.label}</h1>
              <p>
                {
                  (
                    {
                      overview: "매출과 비용, 주요 재무 지표를 한눈에",
                      vouchers: "ERP 원본 전표와 검토 상태를 확인하세요.",
                      projects: "프로젝트와 사업부별 수익성을 비교하세요.",
                      upload: "원본 파일을 검증하고 전표로 반영하세요.",
                      settings: "조직의 회계 기준정보를 관리하세요.",
                    } as Partial<Record<Page, string>>
                  )[page]
                }
              </p>
            </div>
            {page === "overview" && writable && (
              <Button variant="primary" onClick={() => go("upload")}>
                <CloudUpload size={17} />
                ERP 업로드
                <ArrowUpRight size={14} />
              </Button>
            )}
          </div>
          {(["overview", "vouchers", "projects"] as Page[]).includes(page) && (
            <div className="global-filters">
              <label>
                <CalendarDays size={15} />
                회계연도
                <select
                  aria-label="회계연도"
                  value={selectedYear}
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
              </label>
              <label>
                회계기간
                <select
                  aria-label="회계기간"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                사업부
                <select
                  aria-label="사업부"
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                >
                  <option value="">전체 사업부</option>
                  {divisions.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                프로젝트
                <select
                  aria-label="프로젝트"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">전체 프로젝트</option>
                  {data.projects.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {page === "overview" && (
            <Overview
              data={data}
              rows={scope.current}
              previous={scope.previous}
              balances={scope.balances}
              previousBalances={scope.previousBalances}
              year={selectedYear}
              drill={drill}
            />
          )}
          {page === "vouchers" && (
            <Vouchers
              data={data}
              all={ledger}
              filtered={scope.current}
              accountFilter={account}
              setAccountFilter={setAccount}
              canWrite={writable}
              onReview={async (row) => {
                if (demo)
                  store({
                    ...local,
                    reviewed: [...local.reviewed, entryKey(row)],
                  });
                else
                  await mutation({
                    action: "review",
                    date: row.date,
                    entry_no: row.entry_no,
                  });
              }}
            />
          )}
          {page === "projects" && (
            <Projects data={data} rows={scope.current} drill={drill} />
          )}
          {page === "upload" &&
            (writable ? (
              <Upload
                data={data}
                demo={demo}
                ledger={ledger}
                afterSave={(lines: Line[]) => {
                  if (demo)
                    store({
                      ...local,
                      entries: [
                        ...local.entries,
                        ...lines.map((line) => ({
                          ...line,
                          id: crypto.randomUUID(),
                          reviewed: false,
                        })),
                      ],
                    });
                  else router.refresh();
                }}
              />
            ) : (
              <Panel>
                <Empty>전표 업로드 권한이 없습니다.</Empty>
              </Panel>
            ))}
          {page === "settings" && (
            <Settings
              data={data}
              demo={demo}
              save={async (values: {
                type: "account" | "project";
                code: string;
                name: string;
                kind: Group;
              }) => {
                if (!values.code || !values.name)
                  throw new Error("코드와 이름을 입력하세요.");
                if (!demo) {
                  await mutation({ action: "catalog", ...values });
                  return;
                }
                if (values.type === "account")
                  store({
                    ...local,
                    accounts: [
                      ...local.accounts.filter((a) => a.code !== values.code),
                      {
                        code: values.code,
                        name: values.name,
                        kind: values.kind,
                      },
                    ],
                  });
                else
                  store({
                    ...local,
                    projects: [
                      ...local.projects.filter((p) => p.code !== values.code),
                      { code: values.code, name: values.name },
                    ],
                  });
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
