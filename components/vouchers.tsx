"use client";
import { useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  X,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  entryKey,
  fields,
  keys,
  money,
  sums,
  t,
  type LedgerLine,
} from "../lib/ledger";
import type { Workspace } from "../lib/data";
import { Button, Empty, Panel } from "./ui";

export function Vouchers({
  data,
  all,
  filtered,
  canWrite,
  onReview,
  accountFilter,
  setAccountFilter,
}: {
  data: Workspace;
  all: LedgerLine[];
  filtered: LedgerLine[];
  canWrite: boolean;
  onReview: (row: LedgerLine) => Promise<void>;
  accountFilter: string;
  setAccountFilter: (s: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<LedgerLine>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const accounts = useMemo(
    () => new Map(data.accounts.map((a) => [a.code, a.name])),
    [data.accounts],
  );
  const projects = useMemo(
    () => new Map(data.projects.map((a) => [a.code, a.name])),
    [data.projects],
  );
  const rows = useMemo(
    () =>
      filtered.filter((row) => {
        const term = search.trim().toLowerCase();
        return (
          (!from || row.date >= from) &&
          (!to || row.date <= to) &&
          (!status || row.reviewed === (status === "done")) &&
          (!accountFilter || row.account_code === accountFilter) &&
          (!term ||
            [
              row.entry_no,
              row.memo,
              row.vendor,
              row.division,
              row.project_code,
              row.account_code,
              accounts.get(row.account_code),
            ].some((v) => v?.toLowerCase().includes(term)))
        );
      }),
    [filtered, from, to, status, accountFilter, search, accounts],
  );
  const columns = useMemo<ColumnDef<LedgerLine>[]>(
    () => [
      { accessorKey: "date", header: "회계일자" },
      {
        accessorKey: "entry_no",
        header: "전표번호",
        cell: ({ row }) => (
          <button
            className="text-link"
            onClick={() => {
              setSelected(row.original);
              setMessage("");
              dialog.current?.showModal();
            }}
          >
            {row.original.entry_no}
          </button>
        ),
      },
      { accessorKey: "account_code", header: "계정코드" },
      {
        id: "account",
        accessorFn: (row) => accounts.get(row.account_code) ?? row.account_code,
        header: "계정과목",
      },
      { accessorKey: "memo", header: "적요" },
      { accessorKey: "vendor", header: "거래처" },
      ...(["debit", "credit"] as const).map((key) => ({
        accessorKey: key,
        header: fields[key],
        cell: ({ row }: { row: { original: LedgerLine } }) =>
          money(row.original[key]),
        sortingFn: (a: { original: LedgerLine }, b: { original: LedgerLine }) =>
          t(a.original[key]).cmp(b.original[key]),
      })),
      { accessorKey: "division", header: "사업부" },
      {
        id: "project",
        accessorFn: (row) => projects.get(row.project_code) ?? row.project_code,
        header: "프로젝트",
      },
      {
        accessorKey: "reviewed",
        header: "검토 상태",
        cell: ({ row }) => (
          <span className={row.original.reviewed ? "pill green" : "pill"}>
            {row.original.reviewed ? "검토 완료" : "미검토"}
          </span>
        ),
      },
    ],
    [accounts, projects],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "date", desc: true }],
    },
  });
  const totals = useMemo(() => sums(rows), [rows]);
  const details = selected
    ? all.filter((row) => entryKey(row) === entryKey(selected))
    : [];
  return (
    <Panel>
      <div className="panel-head">
        <div>
          <h2>전표 목록</h2>
          <p>
            {rows.length.toLocaleString()}개 분개 · 차변 {money(totals.debit)}원
            · 대변 {money(totals.credit)}원
          </p>
        </div>
        <Button
          onClick={() =>
            void import("../lib/workbook")
              .then((module) =>
                module.exportWorkbook(
                  "전표_내역",
                  [...keys.map((k) => fields[k]), "계정과목", "검토 상태"],
                  table
                    .getSortedRowModel()
                    .rows.map(({ original: r }) => [
                      ...keys.map((k) => r[k]),
                      accounts.get(r.account_code) ?? "미매핑",
                      r.reviewed ? "완료" : "미검토",
                    ]),
                ),
              )
              .catch(() => setMessage("Excel을 내려받지 못했습니다."))
          }
        >
          <Download size={16} />
          Excel
        </Button>
      </div>
      {message && !selected && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <div className="table-filters">
        <label className="search">
          <Search size={16} />
          <input
            placeholder="전표번호, 적요, 거래처 검색"
            aria-label="전표 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          시작일
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          종료일
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <select
          aria-label="계정과목 필터"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="">전체 계정</option>
          {data.accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="검토 상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">전체 검토 상태</option>
          <option value="pending">미검토</option>
          <option value="done">검토 완료</option>
        </select>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((h) => (
                    <th key={h.id}>
                      <button
                        className="sort"
                        aria-label={`${String(h.column.columnDef.header)} 정렬`}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowDownUp size={12} />
                      </button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.original.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>조건에 맞는 전표가 없습니다.</Empty>
      )}
      <div className="pagination">
        <Button
          aria-label="이전 페이지"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          <ChevronLeft size={16} />
        </Button>
        <span>
          {rows.length ? table.getState().pagination.pageIndex + 1 : 0} /{" "}
          {table.getPageCount()}
        </span>
        <Button
          aria-label="다음 페이지"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
      <dialog ref={dialog} onClose={() => setSelected(undefined)}>
        <div className="panel-head">
          <div>
            <h2>{selected?.entry_no}</h2>
            <p>
              {selected?.date} · 분개 {details.length}개
            </p>
          </div>
          <Button
            aria-label="전표 상세 닫기"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </Button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>계정과목</th>
                <th>적요</th>
                <th>차변</th>
                <th>대변</th>
                <th>프로젝트</th>
              </tr>
            </thead>
            <tbody>
              {details.map((row) => (
                <tr key={row.id}>
                  <td>{accounts.get(row.account_code) ?? row.account_code}</td>
                  <td>{row.memo}</td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>{projects.get(row.project_code) ?? row.project_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {selected && canWrite && !details.every((row) => row.reviewed) && (
          <div className="actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  await onReview(selected);
                  setMessage("검토 완료로 표시했습니다.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "검토 상태를 저장하지 못했습니다.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              검토 완료로 표시
            </Button>
          </div>
        )}
      </dialog>
    </Panel>
  );
}
