-- Run after 007 as postgres. All test records are rolled back.
begin;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; plan uuid; test_phone text;
  body jsonb; result jsonb; repeated jsonb; request_uuid uuid; period uuid; member_uuid uuid; blocked boolean=false; kind_value text;
begin
  select id into plan from public.membership_plans where gym_id=gym and code='30';
  loop
    test_phone='9'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
    exit when not exists(select 1 from public.members m where m.gym_id=gym and m.phone=test_phone);
  end loop;
  foreach kind_value in array array['admission','renewal'] loop
    request_uuid=gen_random_uuid();
    body=jsonb_build_object('kind',kind_value,'full_name','Temporary split payment test','phone',test_phone,'member_id',member_uuid,'plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',1000,'paid_amount',700,'payment_mode','Cash + Online','cash_collected',200,'online_collected',500);
    result=public.submit_split_gym_form(gym,request_uuid,body);
    repeated=public.submit_split_gym_form(gym,request_uuid,body);
    period=(result->>'membershipId')::uuid;
    select member_id into member_uuid from public.memberships where id=period;
    if result<>repeated or (select count(*) from public.payments p where p.membership_id=period)<>2 then raise exception 'FAIL: split payment retry'; end if;
    if (select sum(p.amount) from public.payments p where p.membership_id=period and p.payment_mode='Cash')<>200 or (select sum(p.amount) from public.payments p where p.membership_id=period and p.payment_mode='Online')<>500 then raise exception 'FAIL: cash/online ledger amounts'; end if;
    if (select m.final_amount-coalesce(sum(p.amount),0) from public.memberships m left join public.payments p on p.membership_id=m.id where m.id=period group by m.id)<>300 then raise exception 'FAIL: pending balance'; end if;
  end loop;
  begin
    perform public.submit_split_gym_form(gym,gen_random_uuid(),jsonb_set(body,'{online_collected}','499'));
  exception when raise_exception then blocked=true;
  end;
  if not blocked then raise exception 'FAIL: mismatched split accepted'; end if;
end $$;
reset role;
rollback;
select 'PASS: admission and renewal cash/online splits, retries and pending balance; all changes rolled back' as result;
