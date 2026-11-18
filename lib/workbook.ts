import ExcelJS from 'exceljs'
import { fields, keys, required, maxRows, maxBytes, type Field, type Line } from './ledger'

export type Sheet = { name: string; rows: string[][] }
const aliases: Record<Field, string[]> = {
  date: ['전표일자','일자','거래일자'], entry_no: ['전표No','전표'], account_code: ['계정과목코드','계정CD'],
  debit: ['차변금액'], credit: ['대변금액'], project_code: ['프로젝트','PJT코드','현장코드'],
  division: ['사업부명','부서','부서명'], memo: ['적요명','내용'], vendor: ['거래처명'],
}
const norm = (input: string) => input.trim().toLowerCase().replace(/[\s_.()-]/g, '')
export function mapping(headers: string[]) {
  return Object.fromEntries(keys.map(key => [key, headers.findIndex(header => [key, fields[key], ...aliases[key]].some(alias => norm(header) === norm(alias)))])) as Record<Field, number>
}

function csv(text: string) {
  const rows: string[][] = []
  let row: string[] = [], value = '', quoted = false
  const add = () => { row.push(value); rows.push(row); row = []; value = ''; if (rows.length > maxRows + 1) throw new Error('시트 행 수 제한을 초과했습니다.') }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && char === ',') { row.push(value); value = '' }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[i+1] === '\n') i++; add() }
    else value += char
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.')
  if (row.length || value) add()
  return rows
}

export async function readSheets(name: string, bytes: ArrayBuffer): Promise<Sheet[]> {
  if (!/\.(xlsx|csv)$/i.test(name) || !bytes.byteLength || bytes.byteLength > maxBytes) throw new Error('4MB 이하의 XLSX 또는 CSV 파일을 선택하세요.')
  if (/\.csv$/i.test(name)) {
    let decoded: string
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { decoded = new TextDecoder('euc-kr', { fatal: true }).decode(bytes) }
    return [{ name: 'CSV', rows: csv(decoded) }]
  }
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(bytes)
  return book.worksheets.map(sheet => {
    if (sheet.rowCount > maxRows + 1 || sheet.columnCount > 150) throw new Error('시트 행 또는 열 수 제한을 초과했습니다.')
    const rows = Array.from({ length: sheet.rowCount }, (_, i) =>
      Array.from({ length: sheet.columnCount }, (_, j) => {
        const cell = sheet.getCell(i + 1, j + 1)
        if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10)
        return cell.text
      }))
    return { name: sheet.name, rows }
  })
}

export function mappedRows(sheet: Sheet, columns: Record<Field, number>) {
  const headers = sheet.rows[0] ?? []
  const selected = keys.map(key => columns[key]).filter(index => index >= 0)
  if (new Set(selected).size !== selected.length || selected.some(index => !Number.isInteger(index) || index >= headers.length)) throw new Error('각 항목에 서로 다른 유효한 열을 선택하세요.')
  for (const key of required) if (!(columns[key] >= 0)) throw new Error(`필수 열을 매핑하세요 · ${fields[key]}`)
  return sheet.rows.slice(1).map((cells, index) => ({ cells, row: index + 2 })).filter(({cells}) => cells.some(v => v.trim())).map(({cells, row}) => ({
    row, data: Object.fromEntries(keys.map(key => {
      let value = (cells[columns[key]] ?? '').trim()
      if (key === 'date') {
        const match = /^(\d{4})[./-]?(\d{2})[./-]?(\d{2})$/.exec(value)
        if (match) value = match.slice(1).join('-')
      }
      if (key === 'debit' || key === 'credit') {
        if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replaceAll(',', '')
        value = value || '0'
      }
      return [key, value]
    })) as Line,
  }))
}

export async function exportWorkbook(name: string, headers: string[], rows: (string|number)[][]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(name.slice(0, 31))
  sheet.addRow(headers)
  sheet.addRows(rows)
  sheet.getRow(1).font = { bold: true }
  const bytes = await book.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([bytes as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name + '.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
