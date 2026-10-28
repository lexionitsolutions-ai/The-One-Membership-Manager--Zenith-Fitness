-- Run after 008 as postgres. Team IDs do not advance the admission counter.
-- No member IDs, enrollment templates or device access settings are changed.
begin;
create table public.reserved_device_ids (
 gym_id uuid not null references public.gyms(id),device_user_id integer not null check(device_user_id between 1 and 65535),
 admission_id text generated always as ('ZF-'||device_user_id::text) stored,
 full_name text not null,reason text not null default 'Team Zenith',primary key(gym_id,device_user_id),unique(gym_id,admission_id)
);
alter table public.reserved_device_ids enable row level security;
revoke all on public.reserved_device_ids from public,anon,authenticated;
grant select on public.reserved_device_ids to authenticated;
grant all on public.reserved_device_ids to service_role;
create policy reserved_read on public.reserved_device_ids for select to authenticated using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
insert into public.reserved_device_ids(gym_id,device_user_id,full_name) values
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2985,'Hemant Patil (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2986,'Arif Shaikh (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2987,'Lakhan (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2988,'Sonali/Sakshi (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2989,'Atharva Sardesai (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2990,'Sandeep Dhawale (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2991,'Shilpa Patil (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2992,'Tushar Redekar (TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2993,'Swati Maushi'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2994,'Sangita Maushi'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2995,'Rajvira Patil(TZ)'),
 ('b80cd818-2abe-4a90-9027-e2ba1916aec4',2996,'Rajvardhan Patil');
-- Serialize this correction with normal admission creation.
do $$ begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('b80cd818-2abe-4a90-9027-e2ba1916aec4',1)); end $$;
update public.member_id_counters c set last_assigned_id=greatest(660,
 case when exists(select 1 from public.reserved_device_ids r where r.gym_id=c.gym_id and r.device_user_id=c.last_assigned_id) then 660 else c.last_assigned_id end,
 coalesce((select max(m.device_user_id) from public.members m where m.gym_id=c.gym_id and not exists(select 1 from public.reserved_device_ids r where r.gym_id=c.gym_id and (r.device_user_id=m.device_user_id or r.admission_id=m.admission_id))),0),
 coalesce((select max(substring(m.admission_id from 4)::integer) from public.members m where m.gym_id=c.gym_id and m.admission_id ~ '^ZF-[0-9]{1,5}$' and not exists(select 1 from public.reserved_device_ids r where r.gym_id=c.gym_id and (r.device_user_id=m.device_user_id or r.admission_id=m.admission_id))),0))
where c.gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4';
create or replace function public.save_membership(target_gym uuid, payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare member_uuid uuid; membership_uuid uuid; plan_uuid uuid; last_id integer;
  cash_part numeric; online_part numeric; total numeric; discount numeric; paid numeric; member_code text; staff_uuid uuid;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
  select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,1));
  total=(payload->>'total_amount')::numeric; discount=coalesce((payload->>'discount_amount')::numeric,0); paid=coalesce((payload->>'paid_amount')::numeric,0);
  if total is null or total<0 or discount<0 or discount>total or paid<0 or paid>total-discount then raise exception 'Invalid charge, discount, or payment'; end if;
  if total::text in ('NaN','Infinity','-Infinity') or discount::text in ('NaN','Infinity','-Infinity') or paid::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment amount'; end if;
  if payload->>'payment_mode'='Cash + Online' then
    cash_part=(payload->>'cash_collected')::numeric; online_part=(payload->>'online_collected')::numeric;
    if cash_part is null or online_part is null or cash_part::text in ('NaN','Infinity','-Infinity') or online_part::text in ('NaN','Infinity','-Infinity') or cash_part<=0 or online_part<=0 or round(cash_part,2)<>cash_part or round(online_part,2)<>online_part or cash_part+online_part<>paid then
      raise exception 'Cash and online must be positive amounts and add up to the amount received';
    end if;
  elsif payload ? 'cash_collected' or payload ? 'online_collected' then
    raise exception 'Choose Cash + Online to submit a payment breakdown';
  end if;
  if payload->>'kind' not in ('admission','renewal') or payload->>'kind' is null then raise exception 'Choose admission or renewal'; end if;
  if (payload->>'start_date')::date is null or (payload->>'end_date')::date is null or (payload->>'end_date')::date<(payload->>'start_date')::date then raise exception 'Invalid membership dates'; end if;
  select id into plan_uuid from public.membership_plans where gym_id=target_gym and id=(payload->>'plan_id')::uuid and is_active;
  if plan_uuid is null then raise exception 'Choose an active membership plan'; end if;
  if payload->>'kind'='admission' then
    if length(trim(coalesce(payload->>'full_name','')))=0 or length(trim(coalesce(payload->>'phone','')))=0 then raise exception 'Name and phone are required'; end if;
    insert into public.member_id_counters(gym_id,last_assigned_id) values(target_gym,660) on conflict(gym_id) do nothing;
    select greatest(c.last_assigned_id,660,
      coalesce((select max(m.device_user_id) from public.members m where m.gym_id=target_gym and not exists(select 1 from public.reserved_device_ids r where r.gym_id=target_gym and (r.device_user_id=m.device_user_id or r.admission_id=m.admission_id))),0),
      coalesce((select max(substring(m.admission_id from 4)::integer) from public.members m where m.gym_id=target_gym and m.admission_id ~ '^ZF-[0-9]{1,5}$' and not exists(select 1 from public.reserved_device_ids r where r.gym_id=target_gym and (r.device_user_id=m.device_user_id or r.admission_id=m.admission_id))),0))+1 into last_id
    from public.member_id_counters c where c.gym_id=target_gym for update;
    while exists(select 1 from public.reserved_device_ids where gym_id=target_gym and device_user_id=last_id) loop
      last_id=last_id+1;
    end loop;
    if last_id>65535 then raise exception 'Fingerprint ID capacity reached. Contact the administrator.'; end if;
    update public.member_id_counters set last_assigned_id=last_id where gym_id=target_gym;
    member_code='ZF-'||last_id::text;
    insert into public.members(gym_id,admission_id,device_user_id,full_name,phone,category)
    values(target_gym,member_code,last_id,trim(payload->>'full_name'),trim(payload->>'phone'),payload->>'category') returning id into member_uuid;
  else
    select id into member_uuid from public.members where gym_id=target_gym and id=(payload->>'member_id')::uuid and not is_archived;
    if member_uuid is null then raise exception 'Choose an existing member'; end if;
  end if;
  insert into public.memberships(gym_id,member_id,plan_id,kind,start_date,end_date,total_amount,discount_amount,opening_paid_amount,accounting_verified,purchased_at)
  values(target_gym,member_uuid,plan_uuid,payload->>'kind',(payload->>'start_date')::date,(payload->>'end_date')::date,total,discount,0,true,now()) returning id into membership_uuid;
  if payload->>'payment_mode'='Cash + Online' then
    insert into public.payments(gym_id,membership_id,amount,payment_mode,paid_at,recorded_by)
    values(target_gym,membership_uuid,cash_part,'Cash',now(),staff_uuid),
          (target_gym,membership_uuid,online_part,'Online',now(),staff_uuid);
  elsif paid>0 then
    insert into public.payments(gym_id,membership_id,amount,payment_mode,paid_at,recorded_by)
    values(target_gym,membership_uuid,paid,coalesce(nullif(payload->>'payment_mode',''),'Cash'),now(),staff_uuid);
  end if;
  insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
  values
    (target_gym,'google_sheets','membership.saved',membership_uuid::text,jsonb_build_object('member_id',member_uuid,'membership_id',membership_uuid)),
    (target_gym,'fingerprint','membership.saved',membership_uuid::text,jsonb_build_object('member_id',member_uuid,'membership_id',membership_uuid));
  return membership_uuid;
end $$;
revoke all on function public.save_membership(uuid,jsonb) from public,anon;
grant execute on function public.save_membership(uuid,jsonb) to authenticated;
create or replace function public.get_fallback_snapshot(target_gym uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
 -- All projection inputs are selected in one statement/snapshot.
 select jsonb_build_object('gym_id',target_gym,'generated_at',statement_timestamp(),
  'last_admission_id',(select last_assigned_id from public.member_id_counters where gym_id=target_gym),
  'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.members m where m.gym_id=target_gym),'[]'),
  'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.memberships m where m.gym_id=target_gym),'[]'),
  'plans',coalesce((select jsonb_agg(to_jsonb(p)) from public.membership_plans p where p.gym_id=target_gym),'[]'),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)) from public.payments p where p.gym_id=target_gym),'[]'),
  'historicalReceipts',coalesce((select jsonb_agg(to_jsonb(r)) from public.historical_receipts r where r.gym_id=target_gym),'[]'),
  'ptContracts',coalesce((select jsonb_agg(to_jsonb(p)) from public.pt_contracts p where p.gym_id=target_gym),'[]'),
  'reserved_devices',coalesce((select jsonb_agg(to_jsonb(r)) from public.reserved_device_ids r where r.gym_id=target_gym),'[]'),
  'ptPayments',coalesce((select jsonb_agg(to_jsonb(p)) from public.pt_payments p where p.gym_id=target_gym),'[]')) into snapshot;
 return snapshot;
end $$;
revoke all on function public.get_fallback_snapshot(uuid) from public,anon;
grant execute on function public.get_fallback_snapshot(uuid) to authenticated;
commit;
select last_assigned_id as last_regular_admission_id,last_assigned_id+1 as next_regular_candidate
from public.member_id_counters where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4';
