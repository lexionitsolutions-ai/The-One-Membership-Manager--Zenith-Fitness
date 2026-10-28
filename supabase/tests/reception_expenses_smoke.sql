-- Run after 012 as postgres. All fixtures and expenses are rolled back.
begin;
insert into public.gyms(id,name) values('fa000000-0000-4000-8000-000000000098','Temporary reception expense gym');
insert into public.staff(id,gym_id,user_id,full_name,role) values('fa000000-0000-4000-8000-000000000088','fa000000-0000-4000-8000-000000000098','3cf3542d-3425-4b52-991a-858d4c4da6a1','Temporary Reception','receptionist');
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare expense_uuid uuid; changed integer; blocked boolean=false;begin
 insert into public.expenses(gym_id,expense_date,category,description,amount,payment_mode,created_by)
 values('fa000000-0000-4000-8000-000000000098',current_date,'Utilities','Temporary expense',10,'Cash','fa000000-0000-4000-8000-000000000088') returning id into expense_uuid;
 if not exists(select 1 from public.expenses where id=expense_uuid) then raise exception 'FAIL: reception expense visibility'; end if;
 update public.expenses set status='void' where id=expense_uuid;get diagnostics changed=row_count;
 if changed<>0 then raise exception 'FAIL: reception voided an expense'; end if;
 begin insert into public.expenses(gym_id,expense_date,category,description,amount,payment_mode,status,created_by)
 values('fa000000-0000-4000-8000-000000000098',current_date,'Utilities','Forbidden void',10,'Cash','void','fa000000-0000-4000-8000-000000000088');exception when insufficient_privilege then blocked=true;end;
 if not blocked then raise exception 'FAIL: reception inserted a void expense'; end if;
end $$;
reset role;
rollback;
select 'PASS: reception may add/read expenses but cannot void/edit them; all changes rolled back' as result;
