-- Run AFTER the management migration. All changes (including sync jobs) roll back.
begin;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; plan uuid; membership uuid; payment uuid; blocked boolean=false;
begin
  select id into plan from public.membership_plans where gym_id=gym and code='30';
  membership=public.save_membership(gym,jsonb_build_object('kind','admission','full_name','Temporary management test','phone','9000000000',
    'plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',1500,'discount_amount',0,'paid_amount',1000,'payment_mode','Cash'));
  if membership is null then raise exception 'FAIL: admission was not created'; end if;
  if (select sum(amount) from public.payments where membership_id=membership)<>1000 then raise exception 'FAIL: initial payment'; end if;
  begin
    perform public.record_payment(gym,jsonb_build_object('membership_id',membership,'amount',501,'payment_mode','UPI'));
  exception when raise_exception then
    if sqlerrm like 'Payment must be positive%' then blocked=true; else raise; end if;
  end;
  if not blocked then raise exception 'FAIL: overpayment was allowed'; end if;
  payment=public.record_payment(gym,jsonb_build_object('membership_id',membership,'amount',500,'payment_mode','UPI'));
  if payment is null or (select sum(amount) from public.payments where membership_id=membership)<>1500 then raise exception 'FAIL: final payment'; end if;
  if not exists(select 1 from public.sync_jobs where destination='fingerprint' and payload->>'membership_id'=membership::text) then raise exception 'FAIL: fingerprint job missing'; end if;
  if not exists(select 1 from public.audit_logs where entity_id=membership) then raise exception 'FAIL: audit event missing'; end if;
end $$;
reset role;
-- A signed-in user with no active staff assignment cannot call management RPCs.
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false; begin
  begin
    perform public.import_gym_snapshot('b80cd818-2abe-4a90-9027-e2ba1916aec4','{}'::jsonb);
  exception when insufficient_privilege then blocked=true;
  end;
  if not blocked then raise exception 'FAIL: unauthorized import'; end if;
end $$;
reset role;
rollback;
select 'PASS: management checks completed; all test changes rolled back' as result;
