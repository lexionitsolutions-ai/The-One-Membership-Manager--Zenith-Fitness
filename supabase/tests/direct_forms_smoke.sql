-- Run after 003 and 004, as postgres in SQL Editor. No test records are retained.
begin;
do $$ begin
  if to_regprocedure('public.save_membership(uuid,jsonb)') is null
    or to_regprocedure('public.submit_gym_form(uuid,uuid,jsonb)') is null then
    raise exception 'Setup is incomplete. Run supabase/setup/repair_management_and_direct_forms.sql, then rerun this test.';
  end if;
end $$;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; plan uuid; request_id uuid=gen_random_uuid();
  payload jsonb; first_result jsonb; repeated jsonb; renewal jsonb; member_uuid uuid; test_phone text; blocked boolean=false;
begin
  select id into plan from public.membership_plans where gym_id=gym and code='30';
  loop
    test_phone='9'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
    exit when not exists(select 1 from public.members where gym_id=gym and members.phone=test_phone);
  end loop;
  payload=jsonb_build_object('kind','admission','full_name','Temporary direct form test','phone',test_phone,'plan_id',plan,
    'start_date',current_date,'end_date',current_date+30,'total_amount',100,'discount_amount',0,'paid_amount',50,'payment_mode','Cash');
  first_result=public.submit_gym_form(gym,request_id,payload);
  repeated=public.submit_gym_form(gym,request_id,payload);
  if first_result->>'membershipId'<>repeated->>'membershipId' then raise exception 'FAIL: retry created a duplicate'; end if;
  select id into member_uuid from public.members where gym_id=gym and admission_id=first_result->>'admissionId';
  if (select count(*) from public.memberships where gym_id=gym and member_id=member_uuid)<>1 then raise exception 'FAIL: duplicate membership'; end if;
  if (select sum(amount) from public.payments where gym_id=gym and membership_id=(first_result->>'membershipId')::uuid)<>50 then raise exception 'FAIL: initial payment'; end if;
  begin
    perform public.submit_gym_form(gym,request_id,jsonb_set(payload,'{full_name}','"Different name"'));
  exception when raise_exception then
    if sqlerrm like 'The previous submission was already saved%' then blocked=true; else raise; end if;
  end;
  if not blocked then raise exception 'FAIL: reused request ID accepted changed data'; end if;
  renewal=public.submit_gym_form(gym,gen_random_uuid(),jsonb_build_object('kind','renewal','member_id',member_uuid,'plan_id',plan,
    'start_date',current_date+31,'end_date',current_date+61,'total_amount',100,'discount_amount',0,'paid_amount',100,'payment_mode','UPI'));
  if (select max(end_date) from public.memberships where gym_id=gym and member_id=member_uuid)<>current_date+61 then raise exception 'FAIL: renewal expiry'; end if;
  if not exists(select 1 from public.sync_jobs as jobs where jobs.gym_id=gym and jobs.destination='google_sheets' and jobs.payload->>'membership_id'=renewal->>'membershipId') then raise exception 'FAIL: secondary sync job'; end if;
end $$;
reset role;
rollback;
select 'PASS: direct Supabase admission, retry, payment and renewal checks; all changes rolled back' as result;
