-- Run after 202610270003_management.sql. Existing forms now write here first.
begin;
do $$ begin
  if to_regprocedure('public.save_membership(uuid,jsonb)') is null then
    raise exception 'Management setup is incomplete: run 202610270003_management.sql before this migration, or use supabase/setup/repair_management_and_direct_forms.sql for a partial setup.';
  end if;
end $$;
insert into public.membership_plans(gym_id,code,name,duration_days)
values('b80cd818-2abe-4a90-9027-e2ba1916aec4','custom','Customize Package',null)
on conflict(gym_id,code) do nothing;

create table public.form_submissions (
  gym_id uuid not null references public.gyms(id), request_id uuid not null,
  payload_hash text not null, membership_id uuid not null,
  created_at timestamptz not null default now(),primary key(gym_id,request_id),
  foreign key(gym_id,membership_id) references public.memberships(gym_id,id)
);
alter table public.form_submissions enable row level security;
revoke all on public.form_submissions from public,anon,authenticated;
grant select,insert,update,delete on public.form_submissions to service_role;

create function public.submit_gym_form(target_gym uuid,request_uuid uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare period_uuid uuid; member_uuid uuid; member_code text; device_id integer; existing_hash text; fingerprint text;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Active staff access required' using errcode='42501'; end if;
  if request_uuid is null then raise exception 'A submission request ID is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text||request_uuid::text,4));
  fingerprint=md5(payload::text);
  select membership_id,payload_hash into period_uuid,existing_hash from public.form_submissions where gym_id=target_gym and request_id=request_uuid;
  if period_uuid is not null then
    if existing_hash<>fingerprint then raise exception 'The previous submission was already saved. Reload this form before entering another record.'; end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,1));
    if payload->>'kind'='admission' and exists(select 1 from public.members where gym_id=target_gym and phone=payload->>'phone' and not is_archived) then
      raise exception 'This phone already belongs to an existing member. Use the renewal form or search by admission ID.';
    end if;
    period_uuid=public.save_membership(target_gym,payload);
    select member_id into member_uuid from public.memberships where gym_id=target_gym and id=period_uuid;
    if payload->>'kind'='admission' then
      update public.members set gender=nullif(payload->>'gender',''),birth_date=nullif(payload->>'birth_date','')::date,
        legacy_age=nullif(payload->>'age','')::integer where gym_id=target_gym and id=member_uuid;
      insert into public.member_private_details(gym_id,member_id,address,medical_history,remarks)
      values(target_gym,member_uuid,payload->>'address',payload->>'medical_history',payload->>'remarks');
    end if;
    insert into public.form_submissions(gym_id,request_id,payload_hash,membership_id) values(target_gym,request_uuid,fingerprint,period_uuid);
  end if;
  select m.admission_id,m.device_user_id into member_code,device_id
  from public.memberships p join public.members m on m.gym_id=p.gym_id and m.id=p.member_id
  where p.gym_id=target_gym and p.id=period_uuid;
  return jsonb_build_object('success',true,'admissionId',member_code,'membershipId',period_uuid,'deviceUserId',device_id,'savedTo','supabase','secondarySync','queued');
end $$;
revoke all on function public.submit_gym_form(uuid,uuid,jsonb) from public,anon;
grant execute on function public.submit_gym_form(uuid,uuid,jsonb) to authenticated;
commit;
