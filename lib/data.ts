import { type Account, type LedgerLine, type Project } from './ledger'
import { type session } from './auth'

type Db = NonNullable<Awaited<ReturnType<typeof session>>>['db']
export type Role = 'admin'|'accountant'|'auditor'
export type Batch = {id:string; original_name:string; row_count:number; created_at:string}
export type Workspace = {
  org: string; name: string; role: Role; email: string;
  accounts: Account[]; projects: Project[]; ledger: LedgerLine[]; batches: Batch[];
}

export async function catalog(db: Db, org: string) {
  const [accounts,projects] = await Promise.all([
    db.from('accounts').select('code,name,kind').eq('org_id',org).order('code').limit(10000),
    db.from('projects').select('code,name').eq('org_id',org).order('code').limit(10000),
  ])
  if (accounts.error || projects.error) throw new Error('기준정보를 불러오지 못했습니다.')
  return {accounts:accounts.data as Account[],projects:projects.data as Project[]}
}

export async function readLedger(db: Db, org: string, start?: string, end?: string) {
  const lines: LedgerLine[] = []
  for (let offset=0;;offset+=1000) {
    let query = db.from('ledger').select('id,date,entry_no,reviewed,account_code,project_code,debit,credit,division,memo,vendor').eq('org_id',org)
    if (start) query = query.gte('date',start)
    if (end) query = query.lte('date',end)
    const {data,error} = await query.order('id').range(offset,offset+999)
    if (error) throw new Error('전표를 불러오지 못했습니다.')
    lines.push(...data as LedgerLine[])
    if (data.length<1000) return lines
  }
}

export async function membership(db: Db, user: string, org?: string) {
  let query = db.from('memberships').select('org_id,role').eq('user_id',user)
  if (org) query=query.eq('org_id',org)
  const {data,error} = await query.order('org_id').limit(1).maybeSingle()
  if (error) throw new Error('조직 권한을 확인하지 못했습니다.')
  return data as {org_id:string;role:Role}|null
}
