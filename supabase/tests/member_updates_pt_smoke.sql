-- Run after 006 as postgres. All test data and edits are rolled back.
-- If a previous test failed, execute ROLLBACK; first.
begin;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; plan uuid; trainer uuid;
  member_uuid uuid; period uuid; request_uuid uuid; result jsonb; repeat_result jsonb;
  payload jsonb; test_phone text; pt_uuid uuid; blocked boolean;
begin
  select id into plan from public.membership_plans where gym_id=gym and code='30';
  select id into trainer from public.pt_trainers where gym_id=gym and name='Lakhan';
  if trainer is null then raise exception 'Run migration 006 first'; end if;
  loop
    test_phone='9'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
    exit when not exists(select 1 from public.members m where m.gym_id=gym and m.phone=test_phone);
  end loop;
  result=public.submit_gym_form(gym,gen_random_uuid(),jsonb_build_object('kind','admission','full_name','Temporary member edit test','phone',test_phone,'plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',100,'paid_amount',20,'payment_mode','Cash'));
  period=(result->>'membershipId')::uuid;
  select id into member_uuid from public.members m where m.gym_id=gym and m.admission_id=result->>'admissionId';
  request_uuid=gen_random_uuid();
  payload=jsonb_build_object('member_id',member_uuid,'full_name','Corrected test name','phone',test_phone,'reason','Test spelling correction','expected_name','Temporary member edit test','expected_phone',test_phone);
  result=public.manage_member_form(gym,request_uuid,'profile',payload);
  repeat_result=public.manage_member_form(gym,request_uuid,'profile',payload);
  if result<>repeat_result or not exists(select 1 from public.members m where m.id=member_uuid and m.full_name='Corrected test name') then raise exception 'FAIL: profile correction or retry'; end if;
  blocked=false;
  begin perform public.manage_member_form(gym,request_uuid,'profile',jsonb_set(payload,'{full_name}','"Changed retry"')); exception when raise_exception then blocked=true; end;
  if not blocked then raise exception 'FAIL: changed retry accepted'; end if;
  perform public.manage_member_form(gym,gen_random_uuid(),'membership',jsonb_build_object('member_id',member_uuid,'membership_id',period,'plan_id',plan,'start_date',current_date,'end_date',current_date+45,'expected_start',current_date,'expected_end',current_date+30,'expected_plan',plan,'reason','Test extension'));
  if not exists(select 1 from public.memberships m where m.id=period and m.end_date=current_date+45 and m.final_amount=100) then raise exception 'FAIL: expiry change or price preservation'; end if;
  request_uuid=gen_random_uuid();payload=jsonb_build_object('member_id',member_uuid,'membership_id',period,'amount',30,'payment_mode','UPI');
  perform public.manage_member_form(gym,request_uuid,'payment',payload);
  perform public.manage_member_form(gym,request_uuid,'payment',payload);
  if (select sum(p.amount) from public.payments p where p.membership_id=period)<>50 then raise exception 'FAIL: payment retry duplicated collection'; end if;
  blocked=false;
  begin perform public.manage_member_form(gym,gen_random_uuid(),'payment',jsonb_set(payload,'{amount}','51')); exception when raise_exception then blocked=true; end;
  if not blocked then raise exception 'FAIL: membership overpayment accepted'; end if;
  request_uuid=gen_random_uuid();payload=jsonb_build_object('member_id',member_uuid,'trainer_id',trainer,'package','2','start_date',current_date,'end_date',(current_date+interval '2 months')::date,'total_amount',500,'paid_amount',200,'payment_mode','Cash','notes','Temporary PT test');
  result=public.manage_member_form(gym,request_uuid,'pt',payload);
  repeat_result=public.manage_member_form(gym,request_uuid,'pt',payload);
  pt_uuid=(result->>'ptId')::uuid;
  if result<>repeat_result or (select count(*) from public.pt_contracts c where c.member_id=member_uuid)<>1 then raise exception 'FAIL: duplicate PT contract'; end if;
  if (select sum(p.amount) from public.pt_payments p where p.contract_id=pt_uuid)<>200 then raise exception 'FAIL: PT initial collection'; end if;
  request_uuid=gen_random_uuid();payload=jsonb_build_object('member_id',member_uuid,'contract_id',pt_uuid,'amount',300,'payment_mode','UPI');
  perform public.manage_member_form(gym,request_uuid,'pt_payment',payload);
  perform public.manage_member_form(gym,request_uuid,'pt_payment',payload);
  if (select sum(p.amount) from public.pt_payments p where p.contract_id=pt_uuid)<>500 then raise exception 'FAIL: PT pending collection or retry'; end if;
  blocked=false;
  begin perform public.manage_member_form(gym,gen_random_uuid(),'pt_payment',payload); exception when raise_exception then blocked=true; end;
  if not blocked then raise exception 'FAIL: PT overpayment accepted'; end if;
  if not exists(select 1 from public.audit_logs a where a.entity_id=member_uuid and a.action='membership' and a.details->'before'->>'end_date'=(current_date+30)::text) then raise exception 'FAIL: expiry audit history'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false; begin
  if exists(select 1 from public.pt_contracts) or exists(select 1 from public.pt_payments) or exists(select 1 from public.pt_trainers) then raise exception 'FAIL: non-staff PT visibility'; end if;
  begin perform public.manage_member_form('b80cd818-2abe-4a90-9027-e2ba1916aec4',gen_random_uuid(),'profile','{}'); exception when insufficient_privilege then blocked=true; end;
  if not blocked then raise exception 'FAIL: non-staff member update'; end if;
end $$;
reset role;
rollback;
select 'PASS: member corrections, expiry, payments, PT, retries and access; all changes rolled back' as result;
