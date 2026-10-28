-- Run after 008 as postgres. No Sheet/device is contacted; all edits roll back.
begin;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; baseline integer; plan uuid; request_uuid uuid=gen_random_uuid();
 body jsonb; first_result jsonb; repeated jsonb; second_result jsonb; test_phone text; lease jsonb; competing jsonb; snapshot jsonb; changed integer; blocked boolean=false;
begin
 select last_assigned_id into baseline from public.member_id_counters where gym_id=gym;
 if baseline is null or baseline<660 then raise exception 'FAIL: ID floor/counter missing'; end if;
 if to_regclass('public.reserved_device_ids') is not null then
   select greatest(baseline,coalesce(max(m.device_user_id),0)) into baseline from public.members m where m.gym_id=gym
   and not exists(select 1 from public.reserved_device_ids r where r.gym_id=gym and (r.device_user_id=m.device_user_id or r.admission_id=m.admission_id));
 else
   select greatest(baseline,coalesce(max(device_user_id),0)) into baseline from public.members where gym_id=gym;
 end if;
 select id into plan from public.membership_plans where gym_id=gym and code='30';
 loop
   test_phone='9'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
   exit when not exists(select 1 from public.members m where m.gym_id=gym and m.phone=test_phone);
 end loop;
 body=jsonb_build_object('kind','admission','full_name','Temporary ID allocation test','phone',test_phone,'plan_id',plan,'start_date',current_date,'end_date',current_date+30,'total_amount',100,'paid_amount',100,'payment_mode','Cash');
 first_result=public.submit_gym_form(gym,request_uuid,body);
 repeated=public.submit_gym_form(gym,request_uuid,body);
 if first_result<>repeated or (first_result->>'deviceUserId')::integer<>baseline+1 or first_result->>'admissionId'<>'ZF-'||(baseline+1)::text then raise exception 'FAIL: assigned ID or retry'; end if;
 loop
   test_phone='8'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
   exit when not exists(select 1 from public.members m where m.gym_id=gym and m.phone=test_phone);
 end loop;
 second_result=public.submit_gym_form(gym,gen_random_uuid(),jsonb_set(body,'{phone}',to_jsonb(test_phone)));
 if (second_result->>'deviceUserId')::integer<>baseline+2 then raise exception 'FAIL: monotonic ID allocation'; end if;
 snapshot=public.get_fallback_snapshot(gym);
 if (snapshot->>'last_admission_id')::integer<>baseline+2 or snapshot->>'gym_id'<>gym::text then raise exception 'FAIL: snapshot counter/tenant'; end if;
 if not exists(select 1 from jsonb_array_elements(snapshot->'members') m where m->>'admission_id'=second_result->>'admissionId') then raise exception 'FAIL: snapshot member'; end if;
 lease=public.begin_secondary_sync(gym,'google_sheets');
 if (lease->>'busy')::boolean then raise exception 'A real sync is running. Wait for it to finish before rerunning this rollback-only test.'; end if;
 competing=public.begin_secondary_sync(gym,'google_sheets');
 if not (competing->>'busy')::boolean then raise exception 'FAIL: concurrent sync lease'; end if;
 changed=public.finish_secondary_sync(gym,'google_sheets',(lease->>'lease_id')::uuid,false,'Simulated Google outage');
 if changed<2 then raise exception 'FAIL: queued admission jobs not claimed'; end if;
 if exists(select 1 from public.sync_jobs j where j.gym_id=gym and j.status='completed' and j.deduplication_key in (first_result->>'membershipId',second_result->>'membershipId')) then raise exception 'FAIL: failed delivery marked completed'; end if;
 begin perform public.get_fallback_snapshot('fa000000-0000-4000-8000-000000000001'); exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'FAIL: cross-gym snapshot access'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false; begin
 begin perform public.begin_secondary_sync('b80cd818-2abe-4a90-9027-e2ba1916aec4','google_sheets'); exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'FAIL: non-staff sync access'; end if;
 if exists(select 1 from public.member_id_counters) then raise exception 'FAIL: non-staff counter access'; end if;
end $$;
reset role;
rollback;
select 'PASS: Supabase IDs, retry safety, snapshot, sync leases, failed delivery and access; all test changes rolled back' as result;
