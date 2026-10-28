-- Run AFTER 009 as postgres. No physical device/Sheets calls; all edits roll back.
begin;
insert into public.gyms(id,name) values('fa000000-0000-4000-8000-000000000091','Temporary team ID test gym');
insert into public.staff(gym_id,user_id,full_name,role)
values('fa000000-0000-4000-8000-000000000091','3cf3542d-3425-4b52-991a-858d4c4da6a1','Temporary admin','admin');
insert into public.membership_plans(gym_id,code,name,duration_days)
values('fa000000-0000-4000-8000-000000000091','30','Test month',30);
insert into public.member_id_counters(gym_id,last_assigned_id) values('fa000000-0000-4000-8000-000000000091',660);
insert into public.reserved_device_ids(gym_id,device_user_id,full_name)
select 'fa000000-0000-4000-8000-000000000091',device_user_id,full_name from public.reserved_device_ids
where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4';
insert into public.members(gym_id,admission_id,device_user_id,full_name,phone)
values('fa000000-0000-4000-8000-000000000091','ZF-2996',2996,'Temporary Team Zenith','test-only');
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='fa000000-0000-4000-8000-000000000091'; plan uuid; result jsonb;
begin
 if (select count(*) from public.reserved_device_ids where gym_id=gym)<>12 then raise exception 'FAIL: expected 12 reserved IDs'; end if;
 select id into plan from public.membership_plans where gym_id=gym and code='30';
 result=public.submit_gym_form(gym,gen_random_uuid(),jsonb_build_object('kind','admission','full_name','Temporary regular member','phone','9000000000','plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',1,'paid_amount',1,'payment_mode','Cash'));
 if result->>'admissionId'<>'ZF-661' or (result->>'deviceUserId')::integer<>661 then raise exception 'FAIL: team IDs advanced the regular counter'; end if;
 if jsonb_array_length(public.get_fallback_snapshot(gym)->'reserved_devices')<>12 then raise exception 'FAIL: reserved IDs missing from snapshot'; end if;
end $$;
reset role;
update public.member_id_counters set last_assigned_id=2984 where gym_id='fa000000-0000-4000-8000-000000000091';
set local role authenticated;
do $$
declare gym uuid='fa000000-0000-4000-8000-000000000091'; plan uuid; result jsonb;
begin
 select id into plan from public.membership_plans where gym_id=gym and code='30';
 result=public.submit_gym_form(gym,gen_random_uuid(),jsonb_build_object('kind','admission','full_name','Temporary skip test','phone','8000000000','plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',1,'paid_amount',1,'payment_mode','Cash'));
 if result->>'admissionId'<>'ZF-2997' or (result->>'deviceUserId')::integer<>2997 then raise exception 'FAIL: allocation did not skip reserved range'; end if;
end $$;
reset role;
rollback;
select 'PASS: 12 team IDs reserved; regular admissions start at 661 and skip 2985-2996; all test changes rolled back' as result;
