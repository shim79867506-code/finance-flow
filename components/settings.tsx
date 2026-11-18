'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { groups,type Group } from '../lib/ledger'
import type { Workspace } from '../lib/data'
import { Button,Panel } from './ui'
import { groupNames } from './overview'

type Values={type:'account'|'project';code:string;name:string;kind:Group}
export function Settings({data,demo,save}:{data:Workspace;demo:boolean;save:(values:Values)=>Promise<void>}) {
  const {register,handleSubmit,watch,setValue,reset,formState:{isSubmitting}}=useForm<Values>({defaultValues:{type:'account',kind:'asset'}})
  const [message,setMessage]=useState('')
  const type=watch('type')
  const list=type==='account'?data.accounts:data.projects
  return <Panel><div className="panel-head"><div><h2>계정 및 프로젝트 기준정보</h2><p>ERP 업로드에 사용할 계정코드와 프로젝트코드를 등록하세요.</p></div></div>
    <div className="tabs"><Button variant={type==='account'?'primary':'quiet'} onClick={()=>setValue('type','account')}>계정과목</Button><Button variant={type==='project'?'primary':'quiet'} onClick={()=>setValue('type','project')}>프로젝트</Button></div>
    {data.role==='admin'&&<form className="catalog-form" onSubmit={handleSubmit(async values=>{setMessage('');try{await save({...values,code:values.code.trim(),name:values.name.trim()});reset({code:'',name:'',type:values.type,kind:values.kind});setMessage(demo?'샘플 기준정보를 반영했습니다.':'기준정보를 저장했습니다.')}catch(error){setMessage(error instanceof Error?error.message:'기준정보 저장에 실패했습니다.')}})}>
      <label>코드<input {...register('code',{required:true})} maxLength={100} required/></label><label>이름<input {...register('name',{required:true})} maxLength={150} required/></label>
      {type==='account'&&<label>분류<select {...register('kind')}>{groups.map(group=><option key={group} value={group}>{groupNames[group]}</option>)}</select></label>}
      <Button variant="primary" disabled={isSubmitting}>저장</Button>
    </form>}
    {message&&<div className="notice" role="status">{message}</div>}
    <div className="table-scroll"><table><thead><tr><th>코드</th><th>이름</th>{type==='account'&&<th>분류</th>}</tr></thead><tbody>{list.map(item=><tr key={item.code}><td>{item.code}</td><td>{item.name}</td>{'kind'in item&&<td>{groupNames[item.kind as Group]}</td>}</tr>)}</tbody></table></div>
  </Panel>
}
