import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { change, fields,keys,margin,maxBytes,maxRows,profit,summarize,t,validate,validDate,type Line } from '../lib/ledger'
import { demoAccounts,demoProjects } from '../lib/demo'
import { mapping,mappedRows,readSheets } from '../lib/workbook'

const base={date:'2026-02-10',entry_no:'A1',project_code:'P001',division:'기획',memo:'정상',vendor:''}
const pair:Line[]=[
  {...base,account_code:'101',debit:'9007199254740993.21',credit:'0'},
  {...base,account_code:'401',debit:'0',credit:'9007199254740993.21'},
]
const check=(lines:Line[],prior:Line[]=[])=>validate(lines.map((data,i)=>({row:i+2,data})),demoAccounts,demoProjects,prior)
const csv=(rows:string[][])=>new TextEncoder().encode(rows.map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n')).buffer as ArrayBuffer

test('정상 CSV와 Excel 전표에서 큰 금액을 문자열로 전달한다',async()=>{
  const source=[keys.map(k=>fields[k]),...pair.map(row=>keys.map(k=>row[k]))]
  for (const ext of ['csv','xlsx']) {
    const book=new ExcelJS.Workbook()
    book.addWorksheet('전표').addRows(source)
    const bytes=ext==='csv'?csv(source):await book.xlsx.writeBuffer() as ArrayBuffer
    const [sheet]=await readSheets('test.'+ext,bytes)
    const result=validate(mappedRows(sheet,mapping(sheet.rows[0])),demoAccounts,demoProjects)
    assert.deepEqual(result.errors,[])
    assert.equal(result.totals.debit.toFixed(2),'9007199254740993.21')
    assert.ok(result.totals.debit.eq(result.totals.credit))
  }
})
test('필수 열 누락과 중복 매핑을 감지한다',()=>{
  assert.throws(()=>mappedRows({name:'test',rows:[['계정코드']]},mapping(['계정코드'])),/필수 열/)
  const headers=keys.map(k=>fields[k])
  assert.throws(()=>mappedRows({name:'test',rows:[headers]},{...mapping(headers),date:1}),/서로 다른/)
})
test('잘못된 날짜, 계정, 프로젝트, 금액을 행별로 보고한다',()=>{
  const result=check([{...pair[0],date:'2026-02-30',debit:'2.345'},{...pair[1],account_code:'BROKEN',project_code:'UNKNOWN'}])
  assert.ok(result.errors.some(e=>e.row===2&&e.reason.includes('날짜')))
  assert.ok(result.errors.some(e=>e.row===2&&e.reason.includes('금액')))
  assert.ok(result.errors.some(e=>e.row===3&&e.reason.includes('미매핑')))
  assert.ok(result.errors.some(e=>e.row===3&&e.reason.includes('프로젝트')))
  assert.equal(validDate('2024-02-29'),true)
})
test('불균형 전표와 이미 등록한 전표를 검증 단계에서 차단한다',()=>{
  assert.match(check(pair.slice(0,1)).errors[0].reason,/차대변 불일치/)
  assert.equal(check(pair,pair).errors.filter(e=>e.reason.includes('이미')).length,2)
  assert.match(check([{...pair[0],credit:'1'},pair[1]]).errors[0].reason,/한쪽/)
})
test('허용 최대 행 수를 검증하고 초과 파일과 행을 거절한다',async()=>{
  const rows=[keys.map(k=>fields[k]),...Array.from({length:maxRows},(_,i)=>keys.map(k=>({...pair[i%2],entry_no:'CAP-'+Math.floor(i/2)})[k]))]
  const [sheet]=await readSheets('large.csv',csv(rows))
  assert.equal(validate(mappedRows(sheet,mapping(sheet.rows[0])),demoAccounts,demoProjects).errors.length,0)
  await assert.rejects(readSheets('too-many.csv',csv([...rows,rows[1]])),/행 수 제한/)
  await assert.rejects(readSheets('too-big.xlsx',new ArrayBuffer(maxBytes+1)),/4MB/)
})
test('계정 잔액, 프로젝트 손익, 증감률을 Decimal로 계산한다',()=>{
  const amount=summarize([
    {...pair[0],debit:'0.10'},{...pair[1],credit:'0.10'},
    {...pair[0],account_code:'501',debit:'0.03'},
    {...pair[0],account_code:'601',debit:'0.02'},
  ],demoAccounts)
  assert.equal(amount.asset.toFixed(2),'0.10')
  assert.equal(amount.revenue.toFixed(2),'0.10')
  assert.equal(amount.cogs.toFixed(2),'0.03')
  assert.equal(profit(amount).toFixed(2),'0.05')
  assert.equal(margin(profit(amount),amount.revenue)?.toString(),'50')
  assert.equal(change(t('0.15'),t('0.10'))?.toString(),'50')
  assert.equal(change(t(1),t(0)),null)
})
