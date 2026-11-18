'use client'
import { useMemo } from 'react'
import { Activity,ArrowDownRight,ArrowUpRight,BarChart3,BriefcaseBusiness,Coins,Layers3,Landmark,TrendingUp,Wallet } from 'lucide-react'
import { Bar,BarChart,CartesianGrid,Cell,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts'
import { change,margin,money,profit,summarize,type LedgerLine } from '../lib/ledger'
import type { Workspace } from '../lib/data'
import { Empty,Panel } from './ui'

export const groupNames={asset:'자산',liability:'부채',equity:'자본',revenue:'매출',cogs:'매출원가',expense:'판매비와관리비',other:'기타'}
const palette=['#3271ed','#759cfa','#142b56','#a8c6fc','#4677a6','#a4aab8']
const tooltipFormatter=(value:unknown)=>money(String(value??0))+'원'

export function Overview({data,rows,previous,balances,previousBalances,year,drill}:{data:Workspace;rows:LedgerLine[];previous:LedgerLine[];balances:LedgerLine[];previousBalances:LedgerLine[];year:number;drill:(field:'month'|'project'|'division'|'account',value:string)=>void}) {
  const analysis=useMemo(()=>{
    const current=summarize(rows,data.accounts), prior=summarize(previous,data.accounts)
    const assets=summarize(balances,data.accounts), prevAssets=summarize(previousBalances,data.accounts)
    const currentProfit=profit(current), priorProfit=profit(prior)
    const monthly=Array.from({length:12},(_,i)=>{
      const month=String(i+1).padStart(2,'0')
      const values=summarize(rows.filter(r=>r.date.slice(5,7)===month),data.accounts)
      return {month,name:`${i+1}월`,매출:Number(values.revenue),비용:Number(values.cogs.plus(values.expense)),영업이익:Number(profit(values))}
    })
    const costs=data.accounts.filter(a=>a.kind==='cogs'||a.kind==='expense').map(a=>({code:a.code,name:a.name,value:Number(Object.values(summarize(rows.filter(r=>r.account_code===a.code),[a])).reduce((sum,next)=>sum.plus(next)).toString())})).filter(item=>item.value!==0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))
    const project=data.projects.map(p=>{const total=summarize(rows.filter(r=>r.project_code===p.code),data.accounts);return {code:p.code,name:p.name,value:Number(total.cogs)}}).filter(x=>x.value!==0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))
    const division=[...new Set(rows.map(r=>r.division))].map(name=>({code:name,name:name||'미지정',value:Number(profit(summarize(rows.filter(r=>r.division===name),data.accounts)))})).filter(x=>x.code&&x.value!==0)
    const cards=[
      {label:'총매출액',value:current.revenue,old:prior.revenue,Icon:TrendingUp},
      {label:'매출원가',value:current.cogs,old:prior.cogs,Icon:Layers3},
      {label:'판매비와관리비',value:current.expense,old:prior.expense,Icon:Wallet},
      {label:'영업이익',value:currentProfit,old:priorProfit,Icon:BarChart3},
      {label:'영업이익률',value:margin(currentProfit,current.revenue),old:margin(priorProfit,prior.revenue),Icon:Activity,percent:true},
      {label:'총자산',value:assets.asset,old:prevAssets.asset,Icon:Landmark},
      {label:'총부채',value:assets.liability,old:prevAssets.liability,Icon:Coins},
      {label:'총자본',value:assets.equity,old:prevAssets.equity,Icon:BriefcaseBusiness},
    ]
    return {monthly,costs,project,division,cards}
  },[rows,previous,balances,previousBalances,data.accounts,data.projects])
  return <>
    <div className="summary-heading"><h2>핵심 재무 지표</h2><span>단위 KRW · 전년 동기 비교</span></div>
    <div className="kpis">{analysis.cards.map(({label,value,old,Icon,percent})=>{
      const delta=value&&old?value.minus(old):null
      const ratio=value&&old?change(value,old):null
      const display=(v:typeof value)=>v===null?'—':percent?v.toFixed(1)+'%':'₩'+money(v)
      const Arrow=delta?.isNegative()?ArrowDownRight:ArrowUpRight
      return <Panel className="kpi" key={label}><div className="kpi-label"><span>{label}</span><span className="kpi-icon"><Icon size={17}/></span></div>
        <strong>{display(value)}</strong><div className="kpi-compare"><span className={delta?.isNegative()?'down':'up'}>{delta&&<Arrow size={13}/>}
          {delta?(percent?`${delta.toFixed(1)}%p`:`${money(delta)}원`):'—'}{!percent&&ratio&&` (${ratio.toFixed(1)}%)`}</span><span>전년 {display(old)}</span></div></Panel>
    })}</div>
    <div className="chart-grid">
      <Panel><div className="panel-head"><div><h2>월별 매출 · 비용 · 영업이익</h2><p>{year}년 · 월 선택 시 관련 전표로 이동</p></div><div className="legend"><span>매출</span><span>비용</span><span>영업이익</span></div></div>
        {rows.length?<><div className="chart"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <LineChart data={analysis.monthly} margin={{top:12,right:13,left:4,bottom:0}}>
            <CartesianGrid stroke="#eaf0f7" vertical={false}/><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{fill:'#65758a',fontSize:12}}/>
            <YAxis width={52} tickLine={false} axisLine={false} tick={{fill:'#65758a',fontSize:11}} tickFormatter={v=>v===0?'0':(v/1000000)+'백만'}/>
            <Tooltip formatter={tooltipFormatter}/>
            <Line type="monotone" dataKey="매출" stroke="#3271ed" strokeWidth={3} dot={false} isAnimationActive={false}/>
            <Line type="monotone" dataKey="비용" stroke="#759cfa" strokeWidth={2} dot={false} isAnimationActive={false}/>
            <Line type="monotone" dataKey="영업이익" stroke="#142b56" strokeWidth={2} dot={false} isAnimationActive={false}/>
          </LineChart></ResponsiveContainer></div>
          <div className="month-links">{analysis.monthly.map(m=><button key={m.month} onClick={()=>drill('month',m.month)}>{m.name}</button>)}</div></>:<Empty>선택한 기간에 등록된 전표가 없습니다.</Empty>}
      </Panel>
      <Panel><div className="panel-head"><div><h2>계정과목별 비용</h2><p>매출원가 및 판매비와관리비</p></div></div>
        {analysis.costs.length?<Breakdown items={analysis.costs} choose={value=>drill('account',value)}/>:<Empty>집계할 비용이 없습니다.</Empty>}
      </Panel>
      <Panel><div className="panel-head"><h2>사업부별 영업이익</h2></div>
        {analysis.division.length?<Breakdown items={analysis.division} choose={value=>drill('division',value)}/>:<Empty>사업부가 지정된 전표가 없습니다.</Empty>}
      </Panel>
      <Panel><div className="panel-head"><h2>프로젝트별 원가</h2></div>
        {analysis.project.length?<Breakdown items={analysis.project} choose={value=>drill('project',value)}/>:<Empty>집계할 프로젝트 원가가 없습니다.</Empty>}
      </Panel>
    </div>
  </>
}

function Breakdown({items,choose}:{items:{name:string;code:string;value:number}[];choose:(value:string)=>void}) {
  const visible=items.slice(0,6)
  return <><div className="bar-chart"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
    <BarChart data={visible} barSize={24}><CartesianGrid stroke="#edf1f7" vertical={false}/><XAxis dataKey="name" tick={false} axisLine={false}/>
      <YAxis width={49} tick={{fill:'#65758a',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>v===0?'0':(v/1000000)+'백만'}/>
      <Tooltip formatter={tooltipFormatter}/><Bar dataKey="value" name="금액" radius={[4,4,0,0]} isAnimationActive={false} onClick={(_,index)=>{const item=visible[index];if(item)choose(item.code)}}>{visible.map((item,i)=><Cell key={item.code} fill={palette[i]} cursor="pointer"/>)}</Bar>
    </BarChart>
  </ResponsiveContainer></div><div className="breakdown">{visible.map((item,i)=><button key={item.code} onClick={()=>choose(item.code)}><i style={{background:palette[i]}}/>{item.name}<ArrowUpRight size={13}/></button>)}</div></>
}
