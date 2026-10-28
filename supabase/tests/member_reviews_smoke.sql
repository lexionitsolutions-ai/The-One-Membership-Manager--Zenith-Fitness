-- Run after 011 as postgres. All fixtures and follow-up edits are rolled back.
begin;
insert into public.gyms(id,name) values('fa000000-0000-4000-8000-000000000093','Temporary member review gym');
insert into public.staff(gym_id,user_id,full_name,role) values('fa000000-0000-4000-8000-000000000093','3cf3542d-3425-4b52-991a-858d4c4da6a1','Temporary reception','receptionist');
insert into public.membership_plans(id,gym_id,code,name,duration_days) values('fa000000-0000-4000-8000-000000000094','fa000000-0000-4000-8000-000000000093','30','Test month',30);
insert into public.members(id,gym_id,admission_id,device_user_id,full_name,phone) values
 ('fa000000-0000-4000-8000-000000000095','fa000000-0000-4000-8000-000000000093','ZF-1',1,'Temporary expired member','9000000000'),
 ('fa000000-0000-4000-8000-000000000096','fa000000-0000-4000-8000-000000000093','PT-2',2,'Temporary PT member','8000000000');
insert into public.memberships(id,gym_id,member_id,plan_id,kind,start_date,end_date,total_amount) values
 ('fa000000-0000-4000-8000-000000000097','fa000000-0000-4000-8000-000000000093','fa000000-0000-4000-8000-000000000095','fa000000-0000-4000-8000-000000000094','admission',current_date-60,current_date-30,1);
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='fa000000-0000-4000-8000-000000000093'; request_uuid uuid=gen_random_uuid(); body jsonb; saved jsonb; repeated jsonb; blocked boolean=false;
begin
 if not exists(select 1 from public.members where gym_id=gym and admission_id='PT-2' and member_type='personal_training') then raise exception 'FAIL: PT classification'; end if;
 body=jsonb_build_object('membership_id','fa000000-0000-4000-8000-000000000097','status','Called','reason','Busy schedule','contact_type','Call','remark','Requested follow-up','expected_updated_at',null);
 saved=public.save_member_review(gym,request_uuid,body);repeated=public.save_member_review(gym,request_uuid,body);
 if saved<>repeated or (select count(*) from public.member_review_history where gym_id=gym)<>1 then raise exception 'FAIL: retry/history deduplication'; end if;
 body=body||jsonb_build_object('status','Came Back & Renewed','expected_updated_at',saved->'review'->>'updated_at');
 begin perform public.save_member_review(gym,gen_random_uuid(),body);exception when raise_exception then blocked=true;end;
 if not blocked then raise exception 'FAIL: renewed status accepted without an actual renewal'; end if;
 body=body||jsonb_build_object('status','Interested','return_date',(current_date+3)::text);
 saved=public.save_member_review(gym,gen_random_uuid(),body);
 if saved->'review'->>'return_date'<>(current_date+3)::text then raise exception 'FAIL: return date'; end if;
 perform public.submit_gym_form(gym,gen_random_uuid(),jsonb_build_object('kind','renewal','member_id','fa000000-0000-4000-8000-000000000095','plan_id','fa000000-0000-4000-8000-000000000094','start_date',current_date,'end_date',current_date+30,'total_amount',1,'paid_amount',1,'payment_mode','Cash'));
 body=body||jsonb_build_object('status','Came Back & Renewed','expected_updated_at',saved->'review'->>'updated_at');
 saved=public.save_member_review(gym,gen_random_uuid(),body);
 if saved->'review'->>'status'<>'Came Back & Renewed' or (select count(*) from public.member_review_history where gym_id=gym)<>3 then raise exception 'FAIL: returned-member history'; end if;
 blocked=false;begin update public.member_reviews set status='Pending' where gym_id=gym;exception when insufficient_privilege then blocked=true;end;
 if not blocked then raise exception 'FAIL: direct review edits allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false;begin
 if exists(select 1 from public.member_reviews) then raise exception 'FAIL: non-staff review visibility'; end if;
 begin perform public.save_member_review('fa000000-0000-4000-8000-000000000093',gen_random_uuid(),'{}');exception when insufficient_privilege then blocked=true;end;
 if not blocked then raise exception 'FAIL: non-staff review edits'; end if;
end $$;
reset role;
rollback;
select 'PASS: PT classification, review updates, return dates, real renewals, retry history and access; all changes rolled back' as result;
