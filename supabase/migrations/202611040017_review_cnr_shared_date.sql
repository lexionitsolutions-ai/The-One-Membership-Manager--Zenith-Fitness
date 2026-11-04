-- Run after 016. Adds CNR and one shared follow-up/rejoin date for new updates.
-- Existing reviews and immutable history remain unchanged until their next update.
begin;
alter table public.member_reviews drop constraint if exists member_reviews_status_check;
alter table public.member_reviews add constraint member_reviews_status_check
 check(status in ('Pending','Called','Call Not Received (CNR)','WhatsApp Sent','Interested','Call Later','Not Interested','Came Back & Renewed'));
create or replace function public.save_member_review(target_gym uuid,request_uuid uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare period public.memberships; member_row public.members; saved public.member_reviews; old_row public.member_reviews;
 prior public.member_review_history; staff_uuid uuid; response jsonb; today date=(now() at time zone 'Asia/Kolkata')::date;
 renewed boolean; wanted_status text=payload->>'status';
 followup_date date=coalesce(nullif(payload->>'next_follow_up_date',''),nullif(payload->>'return_date',''))::date;
 contact_method text=case when wanted_status='WhatsApp Sent' then 'WhatsApp' when wanted_status='Pending' then 'Other' else 'Call' end;
begin
 if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
 if request_uuid is null then raise exception 'A request ID is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text||request_uuid::text,12));
 select * into prior from public.member_review_history where gym_id=target_gym and request_id=request_uuid;
 if found then
  if prior.payload_hash<>md5(payload::text) then raise exception 'This follow-up was already saved with different values. Reload before another update.'; end if;
  return prior.result;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,1));
 select * into period from public.memberships where gym_id=target_gym and id=(payload->>'membership_id')::uuid and status='confirmed' for update;
 if period.id is null or period.end_date>=today then raise exception 'Choose an expired confirmed membership'; end if;
 select * into member_row from public.members where gym_id=target_gym and id=period.member_id;
 if member_row.is_archived or upper(trim(member_row.admission_id)) like 'PT%' or exists(select 1 from public.reserved_device_ids r where r.gym_id=target_gym and (r.device_user_id=member_row.device_user_id or r.admission_id=member_row.admission_id)) then raise exception 'This member is not in gym renewal follow-ups'; end if;
 select exists(select 1 from public.memberships p where p.gym_id=target_gym and p.member_id=period.member_id and p.status='confirmed' and p.end_date>period.end_date) into renewed;
 if wanted_status='Came Back & Renewed' and not renewed then raise exception 'Record the membership renewal first. The member will then move to Came Back & Renewed.'; end if;
 if renewed and wanted_status is distinct from 'Came Back & Renewed' then raise exception 'This member already renewed. Refresh the list.'; end if;
 if coalesce(wanted_status,'') not in ('Pending','Called','Call Not Received (CNR)','WhatsApp Sent','Interested','Call Later','Not Interested','Came Back & Renewed') then raise exception 'Choose a follow-up status'; end if;
 if wanted_status in ('Interested','Call Later') and followup_date is null then raise exception 'Choose the next follow-up / rejoin date'; end if;
 if payload->>'reason'='Other' and length(trim(coalesce(payload->>'reason_other','')))=0 then raise exception 'Please specify the reason'; end if;
 if length(coalesce(payload->>'remark',''))>4000 or length(coalesce(payload->>'reason_other',''))>1000 then raise exception 'Follow-up notes are too long'; end if;
 select * into old_row from public.member_reviews where gym_id=target_gym and membership_id=period.id for update;
 if old_row.updated_at is distinct from nullif(payload->>'expected_updated_at','')::timestamptz then raise exception 'This follow-up changed. Reload before saving.'; end if;
 select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
 insert into public.member_reviews(gym_id,member_id,membership_id,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,updated_by)
 values(target_gym,period.member_id,period.id,wanted_status,nullif(payload->>'reason',''),nullif(payload->>'reason_other',''),followup_date,followup_date,contact_method,payload->>'remark',staff_uuid)
 on conflict(gym_id,membership_id) do update set status=excluded.status,reason=excluded.reason,reason_other=excluded.reason_other,return_date=excluded.return_date,next_follow_up_date=excluded.next_follow_up_date,contact_type=excluded.contact_type,remark=excluded.remark,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
 response=jsonb_build_object('success',true,'review',to_jsonb(saved));
 insert into public.member_review_history(gym_id,review_id,membership_id,request_id,payload_hash,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,recorded_by,result)
 values(target_gym,saved.id,period.id,request_uuid,md5(payload::text),saved.status,saved.reason,saved.reason_other,saved.return_date,saved.next_follow_up_date,saved.contact_type,saved.remark,staff_uuid,response);
 insert into public.audit_logs(gym_id,actor_user_id,action,entity_type,entity_id,details) values(target_gym,auth.uid(),'review.updated','member_review',saved.id,jsonb_build_object('status',saved.status,'membership_id',period.id));
 return response;
end $$;
revoke all on function public.save_member_review(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_member_review(uuid,uuid,jsonb) to authenticated;

commit;
