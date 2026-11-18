'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { margin,money,profit,summarize,type LedgerLine } from '../lib/ledger'
import type { Workspace } from '../lib/data'
import { Button,Empty,Panel } from './ui'

export function Projects({data,rows,drill}:{data:Workspace;rows:LedgerLine[];drill:(field:'project'|'division',value:string)=>void}) {
  const [group,setGroup]=useState<'project'|'division'>('project')
  const [error,setError]=useState('')
  const items=group==='project'?data.projects:[...new Set(rows.map(r=>r.division))].map(code=>({code,name:code||'미지정'}))
  const headers=[group==='project'?'프로젝트':'사업부','매출액','매출원가','판매비와관리비','영업이익','영업이익률']
  const report=items.flatMap(item=>{
    const scope=rows.filter(r=>group==='project'?r.project_code===item.code:r.division===item.code)
    if (!scope.length) return []
    const totals=summarize(scope,data.accounts), earnings=profit(totals), ratio=margin(earnings,totals.revenue)
    return [{...item,amounts:[totals.revenue,totals.cogs,totals.expense,earnings],ratio}]
  })
  return <Panel><div className="panel-head"><div><h2>손익 비교</h2><p>매핑된 전표 계정 기준 · 단위 KRW</p></div><Button onClick={()=>void import('../lib/workbook').then(m=>m.exportWorkbook('사업별_손익',headers,report.map(r=>[r.name,...r.amounts.map(a=>a.toFixed(2)),r.ratio?.toFixed(2)??'']))).catch(()=>setError('Excel을 내려받지 못했습니다.'))}><Download size={16}/>Excel</Button></div>
    <div className="tabs"><Button variant={group==='project'?'primary':'quiet'} onClick={()=>setGroup('project')}>프로젝트별</Button><Button variant={group==='division'?'primary':'quiet'} onClick={()=>setGroup('division')}>사업부별</Button></div>
    {error&&<div className="notice" role="status">{error}</div>}
    {report.length?<div className="table-scroll"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.map(r=><tr key={r.code}><td>{r.code?<button className="text-link" onClick={()=>drill(group,r.code)}>{r.name}</button>:r.name}</td>{r.amounts.map((a,i)=><td key={i}>{money(a)}</td>)}<td>{r.ratio===null?'—':r.ratio.toFixed(2)+'%'}</td></tr>)}</tbody></table></div>:<Empty>선택한 범위에 집계할 데이터가 없습니다.</Empty>}
  </Panel>
}
