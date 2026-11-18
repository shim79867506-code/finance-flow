import { NextResponse } from 'next/server'
import { z } from 'zod'
import { session } from '../../../lib/auth'
import { membership } from '../../../lib/data'
import { groups, validDate } from '../../../lib/ledger'

const mutation = z.discriminatedUnion('action',[
  z.object({action:z.literal('review'),org:z.uuid(),date:z.string().refine(validDate),entry_no:z.string().min(1).max(100)}),
  z.object({action:z.literal('catalog'),org:z.uuid(),type:z.enum(['account','project']),code:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(150),kind:z.enum(groups)}),
])
export async function POST(request: Request) {
  const current = await session()
  if (!current) return NextResponse.json({error:'로그인이 필요합니다.'},{status:401})
  try {
    const checked = mutation.safeParse(await request.json())
    if (!checked.success) return NextResponse.json({error:'입력값을 확인하세요.'},{status:400})
    const input = checked.data
    const role = (await membership(current.db,current.user.id,input.org))?.role
    if (!role || role==='auditor' || (input.action==='catalog' && role!=='admin')) return NextResponse.json({error:'권한이 없습니다.'},{status:403})
    const {error} = input.action==='review'
      ? await current.db.rpc('review_entry',{p_org:input.org,p_date:input.date,p_number:input.entry_no})
      : await current.db.rpc('catalog_upsert',{p_org:input.org,p_type:input.type,p_code:input.code,p_name:input.name,p_kind:input.kind})
    if (error) return NextResponse.json({error:error.message},{status:422})
    return NextResponse.json({ok:true})
  } catch { return NextResponse.json({error:'요청을 처리할 수 없습니다.'},{status:500}) }
}
