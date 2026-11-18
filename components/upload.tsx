"use client";
import { useRef, useState } from "react";
import {
  CheckCircle2,
  CloudUpload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import {
  fields,
  keys,
  money,
  required,
  validate,
  type Field,
  type LedgerLine,
  type Line,
  type RowError,
} from "../lib/ledger";
import type { Workspace } from "../lib/data";
import type { Sheet } from "../lib/workbook";
import { Button, Empty, Panel } from "./ui";

export function Upload({
  data,
  ledger,
  demo,
  afterSave,
}: {
  data: Workspace;
  ledger: LedgerLine[];
  demo: boolean;
  afterSave: (lines: Line[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [index, setIndex] = useState(0);
  const [columns, setColumns] = useState<Partial<Record<Field, number>>>({});
  const [checked, setChecked] = useState<ReturnType<typeof validate>>();
  const [serverRows, setServerRows] = useState<RowError[]>([]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [working, setWorking] = useState(false);
  const sheet = sheets[index];
  const errors = checked?.errors.length ? checked.errors : serverRows;

  async function open(next: File | undefined) {
    if (!next || working) return;
    setWorking(true);
    setFile(undefined);
    setSheets([]);
    setChecked(undefined);
    setServerRows([]);
    setMessage("");
    setSuccess(false);
    try {
      const { readSheets, mapping } = await import("../lib/workbook");
      const loaded = await readSheets(next.name, await next.arrayBuffer());
      if (!loaded.length) throw new Error("읽을 수 있는 시트가 없습니다.");
      setFile(next);
      setSheets(loaded);
      setIndex(0);
      setColumns(mapping(loaded[0].rows[0] ?? []));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function check() {
    if (!sheet) return;
    setWorking(true);
    setMessage("");
    setSuccess(false);
    setServerRows([]);
    setChecked(undefined);
    try {
      const { mappedRows } = await import("../lib/workbook");
      setChecked(
        validate(
          mappedRows(sheet, columns as Record<Field, number>),
          data.accounts,
          data.projects,
          ledger,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "검증에 실패했습니다.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!file || !checked || checked.errors.length || working) return;
    setWorking(true);
    setMessage("");
    setServerRows([]);
    try {
      if (!demo) {
        const body = new FormData();
        body.append("file", file);
        body.append("org", data.org);
        body.append("sheet", String(index));
        body.append("columns", JSON.stringify(columns));
        const response = await fetch("/api/import", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) {
          setServerRows(result.rows ?? []);
          throw new Error(result.error ?? "저장에 실패했습니다.");
        }
      }
      afterSave(checked.lines);
      setChecked(undefined);
      setFile(undefined);
      setSheets([]);
      setSuccess(true);
      setMessage(
        demo
          ? "샘플 워크스페이스에 반영했습니다. 이 데이터는 브라우저에만 저장됩니다."
          : "원본과 전표를 저장했습니다. 대시보드 및 전표 관리에 반영됩니다.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장에 실패했습니다.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function downloadTemplate() {
    const { exportWorkbook } = await import("../lib/workbook");
    await exportWorkbook(
      "FinanceFlow_전표_양식",
      keys.map((key) => fields[key]),
      [
        [
          "2026-01-15",
          "EXAMPLE-01",
          "101",
          "10000",
          "0",
          "COMMON",
          "디지털사업부",
          "샘플 입금",
          "샘플 거래처",
        ],
        [
          "2026-01-15",
          "EXAMPLE-01",
          "401",
          "0",
          "10000",
          "COMMON",
          "디지털사업부",
          "샘플 매출",
          "샘플 거래처",
        ],
      ],
    );
  }

  return (
    <>
      <Panel>
        <div className="panel-head">
          <div>
            <h2>ERP 전표 업로드</h2>
            <p>Excel (.xlsx) 또는 CSV · 최대 4MB, 시트당 5,000행</p>
          </div>
          <Button
            onClick={() =>
              void downloadTemplate().catch(() =>
                setMessage("양식을 내려받지 못했습니다."),
              )
            }
          >
            <Download size={16} />
            Excel 전표 양식
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          aria-label="전표 파일"
          onChange={(event) => {
            void open(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          className="dropzone"
          aria-label="Excel 또는 CSV 파일 선택"
          disabled={working}
          onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void open(event.dataTransfer.files[0]);
          }}
        >
          {file ? <FileSpreadsheet size={26} /> : <CloudUpload size={28} />}
          <strong>{file?.name ?? "Excel 또는 CSV 파일 선택"}</strong>
          <span>더존 ERP 전표 파일을 이곳으로 끌어 놓을 수도 있습니다.</span>
        </button>
        {sheet && (
          <>
            <label className="sheet-select">
              Excel 시트
              <select
                aria-label="Excel 시트"
                value={index}
                disabled={working}
                onChange={async (event) => {
                  const next = Number(event.currentTarget.value);
                  const { mapping } = await import("../lib/workbook");
                  setIndex(next);
                  setColumns(mapping(sheets[next].rows[0] ?? []));
                  setChecked(undefined);
                  setServerRows([]);
                  setMessage("");
                }}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mapping">
              {keys.map((key) => (
                <label key={key}>
                  {fields[key]}
                  {required.has(key) && " *"}
                  <select
                    disabled={working}
                    value={columns[key] ?? -1}
                    onChange={(event) => {
                      setColumns({
                        ...columns,
                        [key]: Number(event.target.value),
                      });
                      setChecked(undefined);
                      setServerRows([]);
                    }}
                  >
                    <option value={-1}>미선택</option>
                    {(sheet.rows[0] ?? []).map((header, i) => (
                      <option value={i} key={i}>
                        {i + 1}. {header || "(빈 열)"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="table-scroll preview">
              <table>
                <thead>
                  <tr>
                    {keys.map((key) => (
                      <th key={key}>{fields[key]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(1, 6).map((row, i) => (
                    <tr key={i}>
                      {keys.map((key) => (
                        <td key={key}>{row[columns[key] ?? -1] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <Button disabled={working} onClick={() => void check()}>
                데이터 검증
              </Button>
              <Button
                variant="primary"
                disabled={working || !checked || Boolean(errors.length)}
                onClick={() => void save()}
              >
                승인 및 저장
              </Button>
            </div>
          </>
        )}
        {checked && (
          <div
            className={errors.length ? "notice" : "notice good"}
            role="status"
          >
            {checked.lines.length}개 분개 · 차변 {money(checked.totals.debit)}원
            · 대변 {money(checked.totals.credit)}원 · 오류 {errors.length}건
          </div>
        )}
        {!!errors.length && (
          <>
            <div className="actions">
              <Button
                onClick={() =>
                  void import("../lib/workbook")
                    .then((m) =>
                      m.exportWorkbook(
                        "업로드_검증_오류",
                        ["행", "사유"],
                        errors.map((e) => [e.row, e.reason]),
                      ),
                    )
                    .catch(() => setMessage("오류 파일을 내려받지 못했습니다."))
                }
              >
                <Download size={16} />
                오류 Excel
              </Button>
            </div>
            <ul className="issues">
              {errors.slice(0, 100).map((error, i) => (
                <li key={i}>
                  {error.row || "파일"}
                  {error.row ? "행" : ""} · {error.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {message && (
          <div className={success ? "notice good" : "notice"} role="status">
            {success && <CheckCircle2 size={16} />} {message}
          </div>
        )}
      </Panel>
      <Panel>
        <div className="panel-head">
          <h2>최근 업로드 이력</h2>
        </div>
        {data.batches.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>원본 파일</th>
                  <th>행 수</th>
                  <th>등록일</th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <a href={`/api/original?org=${data.org}&id=${batch.id}`}>
                        {batch.original_name}
                      </a>
                    </td>
                    <td>{batch.row_count}</td>
                    <td>
                      {new Date(batch.created_at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>저장된 업로드 이력이 없습니다.</Empty>
        )}
      </Panel>
    </>
  );
}
