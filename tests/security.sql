-- Run as the migration owner on an empty or test Supabase project.
begin;
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','financeflow-sql-admin@example.invalid'),
  ('10000000-0000-4000-8000-000000000002','financeflow-sql-auditor@example.invalid'),
  ('10000000-0000-4000-8000-000000000003','financeflow-sql-accountant@example.invalid');
insert into public.organizations values
  ('20000000-0000-4000-8000-000000000001','TEST A'),
  ('20000000-0000-4000-8000-000000000002','TEST B');
insert into public.memberships values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','auditor'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','accountant');
insert into public.accounts values
  ('20000000-0000-4000-8000-000000000001','A','Cash','asset'),
  ('20000000-0000-4000-8000-000000000001','R','Sales','revenue');
insert into public.projects values ('20000000-0000-4000-8000-000000000001','P','Project');
insert into public.fiscal_periods values ('20000000-0000-4000-8000-000000000001','2026-03-01',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into storage.objects(bucket_id,name,owner_id) values
  ('erp-originals','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('erp-originals','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');

do $$
declare
  org uuid := '20000000-0000-4000-8000-000000000001';
  id uuid := '30000000-0000-4000-8000-000000000001';
  other_id uuid := '30000000-0000-4000-8000-000000000002';
  sha text := repeat('a',64);
  lines jsonb := '[
    {"date":"2026-02-10","entry_no":"T1","account_code":"A","project_code":"P","debit":"9007199254740993.21","credit":"0","division":"D","memo":"","vendor":""},
    {"date":"2026-02-10","entry_no":"T1","account_code":"R","project_code":"P","debit":"0","credit":"9007199254740993.21","division":"D","memo":"","vendor":""}
  ]';
begin
  if public.import_erp(org,id,sha,'test.csv','CSV','{}',lines) <> id then raise exception 'Import returned wrong ID'; end if;
  if public.import_erp(org,other_id,sha,'copy.csv','CSV','{}',lines) <> id then raise exception 'Replay did not return prior batch'; end if;
  begin
    perform public.import_erp(org,other_id,repeat('c',64),'duplicate.csv','CSV','{}',lines);
    raise exception 'Duplicate voucher accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.import_erp(org,other_id,repeat('d',64),'closed.csv','CSV','{}',replace(lines::text,'2026-02-10','2026-03-10')::jsonb);
    raise exception 'Closed period accepted';
  exception when others then if sqlerrm <> '마감된 회계기간입니다.' then raise; end if;
  end;
  begin
    perform public.import_erp(org,other_id,repeat('b',64),'bad.csv','CSV','{}',jsonb_set(jsonb_set(lines,'{0,entry_no}','"T2"'),'{1,entry_no}','"T2"') #- '{1,account_code}');
    raise exception 'Invalid data accepted';
  exception when others then if sqlerrm <> '분개 데이터 형식 오류' then raise; end if;
  end;
  begin
    perform public.import_erp(org,other_id,repeat('e',64),'bad-fk.csv','CSV','{}',replace(jsonb_set(lines,'{1,account_code}','"UNKNOWN"')::text,'T1','T2')::jsonb);
    raise exception 'Unknown account accepted';
  exception when foreign_key_violation then null;
  end;
  if (select count(*) from public.upload_batches)<>1 or (select count(*) from public.ledger)<>2 then raise exception 'Unexpected partial or duplicate data'; end if;
  if (select debit from public.ledger where account_code='A') <> '9007199254740993.21' then raise exception 'Amount precision lost'; end if;
  if (select count(*) from storage.objects where bucket_id='erp-originals')<>1 then raise exception 'Original storage policy mismatch'; end if;
  perform public.review_entry(org,'2026-02-10','T1');
  if exists(select 1 from public.ledger where not reviewed) then raise exception 'Review did not apply'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$
begin
  if (select count(*) from public.ledger)<>2 then raise exception 'Accountant read failed'; end if;
  begin
    perform public.catalog_upsert('20000000-0000-4000-8000-000000000001','account','X','Test','asset');
    raise exception 'Accountant can edit catalog';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$
begin
  if exists(select 1 from public.ledger) then raise exception 'Cross-organization reads allowed'; end if;
  if exists(select 1 from storage.objects where bucket_id='erp-originals') then raise exception 'Original file visible across organizations'; end if;
  begin
    perform public.review_entry('20000000-0000-4000-8000-000000000002','2026-02-10','T1');
    raise exception 'Auditor can review';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.ledger;
    raise exception 'Anonymous reads allowed';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from storage.objects where bucket_id='erp-originals') then raise exception 'Original file visible to anonymous user'; end if;
end $$;
reset role;
rollback;
select 'FINANCEFLOW SQL SECURITY PASSED' as status;
