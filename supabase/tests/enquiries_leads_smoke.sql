-- Run after migration 005, as postgres. All fixtures are rolled back.
begin;
do $$ begin
  if to_regprocedure('public.submit_enquiry(uuid,uuid,jsonb)') is null then raise exception 'Run migration 005 before this test'; end if;
end $$;
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4'; request_uuid uuid=gen_random_uuid();
  payload jsonb; result jsonb; repeated jsonb; lead_uuid uuid;
begin
  payload=jsonb_build_object('full_name','Temporary enquiry test','phone','9000000000','email','example@example.com','address','Test address',
    'source','Referral','interested_plan','Gym','follow_up_date',current_date::text,'notes','Test requirements');
  result=public.submit_enquiry(gym,request_uuid,payload);
  repeated=public.submit_enquiry(gym,request_uuid,payload);
  lead_uuid=(result->>'enquiryId')::uuid;
  if lead_uuid is null or repeated->>'enquiryId'<>result->>'enquiryId' then raise exception 'FAIL: enquiry idempotency'; end if;
  if not exists(select 1 from public.enquiries e where e.id=lead_uuid and e.gym_id=gym and e.address='Test address' and e.email='example@example.com' and e.source='Referral') then raise exception 'FAIL: enquiry field preservation'; end if;
  perform public.update_enquiry_followup(gym,lead_uuid,jsonb_build_object('lead_status','Trial Done','next_follow_up_date',(current_date+1)::text,'remark','Requested an evening call'));
  if not exists(select 1 from public.enquiries e where e.id=lead_uuid and e.gym_id=gym and e.lead_status='Trial Done' and e.next_follow_up_date=current_date+1) then raise exception 'FAIL: next follow-up not saved'; end if;
  if (select count(*) from public.enquiry_followups h where h.gym_id=gym and h.enquiry_id=lead_uuid)<>1 then raise exception 'FAIL: follow-up history'; end if;
  if not exists(select 1 from public.sync_jobs j where j.gym_id=gym and j.event_type='enquiry.created' and j.payload->>'enquiry_id'=lead_uuid::text) then raise exception 'FAIL: secondary enquiry sync not queued'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false; begin
  begin
    perform public.submit_enquiry('b80cd818-2abe-4a90-9027-e2ba1916aec4',gen_random_uuid(),'{}');
  exception when insufficient_privilege then blocked=true;
  end;
  if not blocked then raise exception 'FAIL: non-staff enquiry write'; end if;
end $$;
reset role;
rollback;
select 'PASS: enquiry save, retry, fields, follow-up, history and access checks; all changes rolled back' as result;
