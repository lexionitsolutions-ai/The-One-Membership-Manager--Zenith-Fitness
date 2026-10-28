-- Run after 010 as postgres. No IDs, payments or device access are changed.
begin;
alter table public.members add column member_type text generated always as
 (case when upper(trim(admission_id)) like 'PT%' then 'personal_training' else 'gym' end) stored;
create table public.member_reviews (
 id uuid primary key default gen_random_uuid(),gym_id uuid not null references public.gyms(id),member_id uuid not null,membership_id uuid not null,
 status text not null default 'Pending' check(status in ('Pending','Called','WhatsApp Sent','Interested','Call Later','Not Interested','Came Back & Renewed')),
 reason text check(reason in ('Busy schedule','Health / injury','Travel / out of station','Financial reasons','Joined another gym','Timing issues','Not satisfied','No response','Other')),
 reason_other text,return_date date,next_follow_up_date date,contact_type text not null check(contact_type in ('Call','WhatsApp','Visit','Other')),remark text,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null,
 unique(gym_id,membership_id),unique(gym_id,id),
 foreign key(gym_id,member_id) references public.members(gym_id,id),
 foreign key(gym_id,membership_id) references public.memberships(gym_id,id),
 foreign key(gym_id,updated_by) references public.staff(gym_id,id)
);
create table public.member_review_history (
 id uuid primary key default gen_random_uuid(),gym_id uuid not null references public.gyms(id),review_id uuid not null,membership_id uuid not null,
 request_id uuid not null,payload_hash text not null,status text not null,reason text,reason_other text,return_date date,next_follow_up_date date,
 contact_type text not null,remark text,created_at timestamptz not null default clock_timestamp(),recorded_by uuid not null,result jsonb not null,
 unique(gym_id,request_id),foreign key(gym_id,review_id) references public.member_reviews(gym_id,id),
 foreign key(gym_id,membership_id) references public.memberships(gym_id,id),foreign key(gym_id,recorded_by) references public.staff(gym_id,id)
);
create index member_review_history_period_idx on public.member_review_history(gym_id,membership_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['member_reviews','member_review_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy review_read on public.%I for select to authenticated using (zenith_private.staff_role(gym_id) in (''admin'',''receptionist''))',t);
 end loop;
end $$;
create or replace function public.save_member_review(target_gym uuid,request_uuid uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare period public.memberships; member_row public.members; saved public.member_reviews; old_row public.member_reviews;
 prior public.member_review_history; staff_uuid uuid; response jsonb; today date=(now() at time zone 'Asia/Kolkata')::date;
 renewed boolean; wanted_status text=payload->>'status';
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
 if coalesce(wanted_status,'') not in ('Pending','Called','WhatsApp Sent','Interested','Call Later','Not Interested','Came Back & Renewed') then raise exception 'Choose a follow-up status'; end if;
 if wanted_status='Interested' and nullif(payload->>'return_date','') is null then raise exception 'Choose when the member is interested in joining again'; end if;
 if wanted_status='Call Later' and nullif(payload->>'next_follow_up_date','') is null then raise exception 'Choose the next follow-up date'; end if;
 if payload->>'reason'='Other' and length(trim(coalesce(payload->>'reason_other','')))=0 then raise exception 'Please specify the reason'; end if;
 if length(coalesce(payload->>'remark',''))>4000 or length(coalesce(payload->>'reason_other',''))>1000 then raise exception 'Follow-up notes are too long'; end if;
 select * into old_row from public.member_reviews where gym_id=target_gym and membership_id=period.id for update;
 if old_row.updated_at is distinct from nullif(payload->>'expected_updated_at','')::timestamptz then raise exception 'This follow-up changed. Reload before saving.'; end if;
 select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
 insert into public.member_reviews(gym_id,member_id,membership_id,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,updated_by)
 values(target_gym,period.member_id,period.id,wanted_status,nullif(payload->>'reason',''),nullif(payload->>'reason_other',''),nullif(payload->>'return_date','')::date,nullif(payload->>'next_follow_up_date','')::date,payload->>'contact_type',payload->>'remark',staff_uuid)
 on conflict(gym_id,membership_id) do update set status=excluded.status,reason=excluded.reason,reason_other=excluded.reason_other,return_date=excluded.return_date,next_follow_up_date=excluded.next_follow_up_date,contact_type=excluded.contact_type,remark=excluded.remark,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
 response=jsonb_build_object('success',true,'review',to_jsonb(saved));
 insert into public.member_review_history(gym_id,review_id,membership_id,request_id,payload_hash,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,recorded_by,result)
 values(target_gym,saved.id,period.id,request_uuid,md5(payload::text),saved.status,saved.reason,saved.reason_other,saved.return_date,saved.next_follow_up_date,saved.contact_type,saved.remark,staff_uuid,response);
 insert into public.audit_logs(gym_id,actor_user_id,action,entity_type,entity_id,details) values(target_gym,auth.uid(),'review.updated','member_review',saved.id,jsonb_build_object('status',saved.status,'membership_id',period.id));
 return response;
end $$;
revoke all on function public.save_member_review(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_member_review(uuid,uuid,jsonb) to authenticated;
insert into public.whatsapp_templates(gym_id,template_key,title,body,variables)
values('b80cd818-2abe-4a90-9027-e2ba1916aec4','member_review','Expired member follow-up',
 'Hello {{member_name}},

Your Zenith Fitness membership ended on {{end_date}}.
Admission ID: {{admission_id}}

We would be happy to welcome you back. Please let us know when you would like to rejoin, or how we can help.

Team Zenith Fitness',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','return_date','next_follow_up_date','reason']);
commit;
select 'PT classification and member review follow-ups ready' as result;
