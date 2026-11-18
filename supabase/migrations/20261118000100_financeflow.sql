create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
create table public.profiles (id uuid primary key references auth.users on delete cascade, full_name text not null);
create table public.memberships (
  org_id uuid references public.organizations on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null check(role in ('admin','accountant','auditor')), primary key(org_id,user_id)
);
create index memberships_user on public.memberships(user_id);
create table public.fiscal_periods (
  org_id uuid references public.organizations, month date check(extract(day from month)=1),
  closed boolean not null default false, primary key(org_id,month)
);
create table public.accounts (
  org_id uuid references public.organizations, code text, name text not null,
  kind text not null check(kind in ('asset','liability','equity','revenue','cogs','expense','other')),
  primary key(org_id,code)
);
create table public.projects (org_id uuid references public.organizations, code text, name text not null, primary key(org_id,code));
create table public.upload_batches (
  org_id uuid references public.organizations, id uuid, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  original_name text not null, storage_path text unique not null, sheet text not null, column_mapping jsonb not null,
  row_count int not null check(row_count between 1 and 5000), debit_total numeric not null, credit_total numeric not null,
  created_by uuid not null references auth.users, created_at timestamptz not null default now(),
  primary key(org_id,id), unique(org_id,sha256), check(debit_total=credit_total)
);
create table public.journal_entries (
  org_id uuid references public.organizations, id uuid default gen_random_uuid(), batch_id uuid not null,
  date date not null, entry_no text not null, reviewed boolean not null default false,
  primary key(org_id,id), unique(org_id,date,entry_no),
  foreign key(org_id,batch_id) references public.upload_batches
);
create index entries_batch on public.journal_entries(org_id,batch_id);
create table public.journal_lines (
  org_id uuid references public.organizations, id uuid default gen_random_uuid(), entry_id uuid not null,
  account_code text not null, project_code text not null, division text not null, memo text not null, vendor text not null,
  debit numeric(20,2) not null check(debit>=0 and debit<'Infinity'::numeric),
  credit numeric(20,2) not null check(credit>=0 and credit<'Infinity'::numeric),
  primary key(org_id,id), foreign key(org_id,entry_id) references public.journal_entries,
  foreign key(org_id,account_code) references public.accounts, foreign key(org_id,project_code) references public.projects,
  check((debit=0) <> (credit=0))
);
create index lines_entry on public.journal_lines(org_id,entry_id);
create index lines_account on public.journal_lines(org_id,account_code);
create index lines_project on public.journal_lines(org_id,project_code);
create table public.activity_logs (
  id bigint generated always as identity primary key, org_id uuid not null references public.organizations,
  actor uuid not null references auth.users, action text not null, detail jsonb not null, created_at timestamptz not null default now()
);
create index activity_org on public.activity_logs(org_id,created_at);

-- Reserved for later phases. Public writes are disabled until the workflows are implemented.
create table public.adjustment_entries (org_id uuid references public.organizations, id uuid default gen_random_uuid(), date date not null, note text not null, primary key(org_id,id));
create table public.allocation_rules (org_id uuid references public.organizations, id uuid default gen_random_uuid(), name text not null, basis jsonb not null, primary key(org_id,id));
create table public.expense_contracts (org_id uuid references public.organizations, id uuid default gen_random_uuid(), account_code text not null, name text not null, starts date not null, ends date not null check(ends>=starts), amount numeric(20,2) not null check(amount>=0), primary key(org_id,id), foreign key(org_id,account_code) references public.accounts);
create table public.closing_tasks (org_id uuid references public.organizations, id uuid default gen_random_uuid(), month date not null, title text not null, status text not null default 'pending', primary key(org_id,id), foreign key(org_id,month) references public.fiscal_periods);
create table public.audit_requests (org_id uuid references public.organizations, id uuid default gen_random_uuid(), title text not null, due_date date, status text not null default 'pending', primary key(org_id,id));
create table public.attachments (org_id uuid references public.organizations, id uuid default gen_random_uuid(), entry_id uuid not null, storage_path text unique not null, primary key(org_id,id), foreign key(org_id,entry_id) references public.journal_entries);

create function private.org_role(org uuid) returns text language sql stable security definer set search_path='' as $$
  select role from public.memberships where org_id=org and user_id=(select auth.uid())
$$;
revoke all on function private.org_role(uuid) from public, anon;
grant execute on function private.org_role(uuid) to authenticated;

do $$
declare tbl text;
begin
  foreach tbl in array array['fiscal_periods','accounts','projects','upload_batches','journal_entries','journal_lines','activity_logs','adjustment_entries','allocation_rules','expense_contracts','closing_tasks','audit_requests','attachments'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from anon, authenticated',tbl);
    execute format('grant select on public.%I to authenticated',tbl);
    execute format('create policy org_read on public.%I for select to authenticated using (private.org_role(org_id) is not null)',tbl);
  end loop;
end $$;
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
revoke all on public.organizations,public.profiles,public.memberships from anon,authenticated;
grant select on public.organizations,public.profiles,public.memberships to authenticated;
create policy org_read on public.organizations for select to authenticated using(private.org_role(id) is not null);
create policy self_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy self_read on public.memberships for select to authenticated using(user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit) values ('erp-originals','erp-originals',false,4194304);
create policy erp_write on storage.objects for insert to authenticated with check (
  bucket_id='erp-originals' and
  case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$' then private.org_role(split_part(name,'/',1)::uuid) in ('admin','accountant') else false end
);
create policy erp_read on storage.objects for select to authenticated using (
  bucket_id='erp-originals' and exists (select 1 from public.upload_batches b where b.storage_path=name)
);

create view public.ledger with (security_invoker=true) as
select l.org_id,l.id,e.date,e.entry_no,e.reviewed,l.account_code,l.project_code,
       l.debit::text as debit,l.credit::text as credit,l.division,l.memo,l.vendor
from public.journal_lines l join public.journal_entries e on (l.org_id,l.entry_id)=(e.org_id,e.id);
revoke all on public.ledger from anon,authenticated;
grant select on public.ledger to authenticated;

create function private.import_erp(p_org uuid,p_id uuid,p_sha text,p_name text,p_sheet text,p_map jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  storage_key text := p_org::text || '/' || p_id::text;
  row_count int;
  existing_id uuid;
begin
  if auth.uid() is null or coalesce(private.org_role(p_org),'') not in ('admin','accountant') then
    raise exception '전표 업로드 권한이 없습니다.' using errcode='42501';
  end if;
  perform 1 from public.organizations where id=p_org for update;
  select id into existing_id from public.upload_batches where org_id=p_org and sha256=p_sha;
  if existing_id is not null then return existing_id; end if;
  if not exists (select 1 from storage.objects where bucket_id='erp-originals' and name=storage_key and owner_id=auth.uid()::text) then
    raise exception '원본 파일을 찾을 수 없습니다.';
  end if;
  row_count := jsonb_array_length(p_lines);
  if row_count is null or row_count not between 1 and 5000 then raise exception '분개 행 수 오류'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_lines) as j(date text,entry_no text,account_code text,project_code text, debit text,credit text,division text,memo text,vendor text)
    where date is null or date !~ '^\d{4}-\d{2}-\d{2}$' or date::date < date '1900-01-01'
      or btrim(coalesce(entry_no,''))='' or length(entry_no)>100
      or btrim(coalesce(account_code,''))='' or btrim(coalesce(project_code,''))=''
      or debit is null or credit is null or debit !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$' or credit !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$'
      or length(division)>100 or length(memo)>1000 or length(vendor)>200
  ) then raise exception '분개 데이터 형식 오류'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as j(date date,entry_no text,debit numeric,credit numeric)
    group by date,entry_no having sum(debit)<>sum(credit)
  ) then raise exception '차대변 불일치'; end if;

  -- Lock existing period rows so a concurrent close cannot slip through validation.
  perform 1 from public.fiscal_periods p where p.org_id=p_org and p.month in (
    select date_trunc('month',j.date)::date from jsonb_to_recordset(p_lines) as j(date date)
  ) order by p.month for update;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as j(date date)
    join public.fiscal_periods p on p.org_id=p_org and p.month=date_trunc('month',j.date)::date where p.closed
  ) then raise exception '마감된 회계기간입니다.'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_lines) as j(date date,entry_no text)
    join public.journal_entries e on e.org_id=p_org and e.date=j.date and e.entry_no=j.entry_no
  ) then raise exception '이미 저장된 전표가 있습니다.' using errcode='23505'; end if;

  insert into public.upload_batches(org_id,id,sha256,original_name,storage_path,sheet,column_mapping,row_count,debit_total,credit_total,created_by)
    select p_org,p_id,p_sha,p_name,storage_key,p_sheet,p_map,row_count,sum(debit),sum(credit),auth.uid()
    from jsonb_to_recordset(p_lines) as j(debit numeric,credit numeric);
  insert into public.journal_entries(org_id,batch_id,date,entry_no)
    select distinct p_org,p_id,date,entry_no from jsonb_to_recordset(p_lines) as j(date date,entry_no text);
  insert into public.journal_lines(org_id,entry_id,account_code,project_code,debit,credit,division,memo,vendor)
    select p_org,e.id,j.account_code,j.project_code,j.debit,j.credit,j.division,j.memo,j.vendor
    from jsonb_to_recordset(p_lines) as j(date date,entry_no text,account_code text,project_code text,debit numeric,credit numeric,division text,memo text,vendor text)
    join public.journal_entries e on e.org_id=p_org and e.date=j.date and e.entry_no=j.entry_no and e.batch_id=p_id;
  insert into public.activity_logs(org_id,actor,action,detail) values(p_org,auth.uid(),'erp.import',jsonb_build_object('batch',p_id,'rows',row_count));
  return p_id;
end $$;
revoke all on function private.import_erp(uuid,uuid,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function private.import_erp(uuid,uuid,text,text,text,jsonb,jsonb) to authenticated;
create function public.import_erp(p_org uuid,p_id uuid,p_sha text,p_name text,p_sheet text,p_map jsonb,p_lines jsonb)
returns uuid language sql security invoker set search_path='' as $$
  select private.import_erp(p_org,p_id,p_sha,p_name,p_sheet,p_map,p_lines)
$$;
revoke all on function public.import_erp(uuid,uuid,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.import_erp(uuid,uuid,text,text,text,jsonb,jsonb) to authenticated;

create function private.review_entry(p_org uuid,p_date date,p_number text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(private.org_role(p_org),'') not in ('admin','accountant') then
    raise exception '검토 권한이 없습니다.' using errcode='42501';
  end if;
  update public.journal_entries set reviewed=true where org_id=p_org and date=p_date and entry_no=p_number and not reviewed;
  if found then
    insert into public.activity_logs(org_id,actor,action,detail)
      values(p_org,auth.uid(),'journal.review',jsonb_build_object('date',p_date,'number',p_number));
  end if;
end $$;
revoke all on function private.review_entry(uuid,date,text) from public,anon;
grant execute on function private.review_entry(uuid,date,text) to authenticated;
create function public.review_entry(p_org uuid,p_date date,p_number text) returns void language sql set search_path='' as $$
  select private.review_entry(p_org,p_date,p_number)
$$;
revoke all on function public.review_entry(uuid,date,text) from public,anon;
grant execute on function public.review_entry(uuid,date,text) to authenticated;

create function private.bootstrap_org(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare new_org uuid;
begin
  if auth.uid() is null or length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception '조직 이름을 확인하세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.memberships where user_id=auth.uid()) then raise exception '이미 소속 조직이 있습니다.'; end if;
  insert into public.organizations(name) values(btrim(p_name)) returning id into new_org;
  insert into public.memberships values(new_org,auth.uid(),'admin');
  insert into public.accounts values
    (new_org,'101','현금 및 현금성자산','asset'),(new_org,'201','미지급금','liability'),(new_org,'301','자본금','equity'),
    (new_org,'401','매출액','revenue'),(new_org,'501','매출원가','cogs'),(new_org,'601','판매비와관리비','expense');
  insert into public.projects values(new_org,'COMMON','공통');
  insert into public.activity_logs(org_id,actor,action,detail) values(new_org,auth.uid(),'org.create','{}');
  return new_org;
end $$;
revoke all on function private.bootstrap_org(text) from public,anon;
grant execute on function private.bootstrap_org(text) to authenticated;
create function public.bootstrap_org(p_name text) returns uuid language sql set search_path='' as $$ select private.bootstrap_org(p_name) $$;
revoke all on function public.bootstrap_org(text) from public,anon;
grant execute on function public.bootstrap_org(text) to authenticated;

create function private.catalog_upsert(p_org uuid,p_type text,p_code text,p_name text,p_kind text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or private.org_role(p_org) is distinct from 'admin' then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_code,''))) not between 1 and 100 or length(btrim(coalesce(p_name,''))) not between 1 and 150 then raise exception '코드 또는 이름이 올바르지 않습니다.'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if p_type='account' then
    if exists(select 1 from public.journal_lines where org_id=p_org and account_code=p_code)
      and exists(select 1 from public.accounts where org_id=p_org and code=p_code and kind<>p_kind) then
      raise exception '전표에 사용된 계정의 분류는 변경할 수 없습니다.';
    end if;
    insert into public.accounts values(p_org,p_code,p_name,p_kind) on conflict(org_id,code) do update set name=excluded.name,kind=excluded.kind;
  elsif p_type='project' then
    insert into public.projects values(p_org,p_code,p_name) on conflict(org_id,code) do update set name=excluded.name;
  else raise exception '지원하지 않는 기준정보 유형입니다.';
  end if;
  insert into public.activity_logs(org_id,actor,action,detail)
    values(p_org,auth.uid(),'catalog.upsert',jsonb_build_object('type',p_type,'code',p_code,'name',p_name,'kind',p_kind));
end $$;
revoke all on function private.catalog_upsert(uuid,text,text,text,text) from public,anon;
grant execute on function private.catalog_upsert(uuid,text,text,text,text) to authenticated;
create function public.catalog_upsert(p_org uuid,p_type text,p_code text,p_name text,p_kind text) returns void language sql set search_path='' as $$
  select private.catalog_upsert(p_org,p_type,p_code,p_name,p_kind)
$$;
revoke all on function public.catalog_upsert(uuid,text,text,text,text) from public,anon;
grant execute on function public.catalog_upsert(uuid,text,text,text,text) to authenticated;
