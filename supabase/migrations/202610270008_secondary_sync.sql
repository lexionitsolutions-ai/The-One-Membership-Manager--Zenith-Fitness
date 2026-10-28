-- Run AFTER 007 as postgres. No external services are called by this migration.
-- 660 is a floor, never a reset. Existing higher IDs remain reserved.
begin;
create table public.member_id_counters (
 gym_id uuid primary key references public.gyms(id), last_assigned_id integer not null check(last_assigned_id>=660)
);
alter table public.member_id_counters enable row level security;
revoke all on public.member_id_counters from public,anon,authenticated;
grant select on public.member_id_counters to authenticated;
grant all on public.member_id_counters to service_role;
create policy counter_read on public.member_id_counters for select to authenticated using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
insert into public.member_id_counters(gym_id,last_assigned_id)
select g.id,greatest(660,coalesce((select max(m.device_user_id) from public.members m where m.gym_id=g.id),0),coalesce((select max(substring(m.admission_id from 4)::integer) from public.members m where m.gym_id=g.id and m.admission_id ~ '^ZF-[0-9]{1,5}$'),0)) from public.gyms g;
-- Browser clients cannot choose or alter a member's database/device identity.
-- Security-definer admission/import functions remain responsible for creation.
revoke insert,update on public.members from authenticated;
grant update(full_name,phone,gender,birth_date,legacy_age,category,is_archived,needs_review,updated_at) on public.members to authenticated;
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
    update public.member_id_counters set last_assigned_id=greatest(last_assigned_id,660,
      coalesce((select max(device_user_id) from public.members where gym_id=target_gym),0),
      coalesce((select max(substring(admission_id from 4)::integer) from public.members where gym_id=target_gym and admission_id ~ '^ZF-[0-9]{1,5}$'),0))+1
    where gym_id=target_gym returning last_assigned_id into last_id;
    if last_id>65535 then raise exception 'Fingerprint ID capacity reached. Contact the administrator.'; end if;
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

create table public.secondary_sync_leases (
 gym_id uuid not null references public.gyms(id),destination text not null check(destination in ('google_sheets','fingerprint')),
 lease_id uuid not null, expires_at timestamptz not null,primary key(gym_id,destination)
);
alter table public.secondary_sync_leases enable row level security;
revoke all on public.secondary_sync_leases from public,anon,authenticated;
grant all on public.secondary_sync_leases to service_role;
alter table public.sync_jobs add column lease_id uuid;

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
  'ptPayments',coalesce((select jsonb_agg(to_jsonb(p)) from public.pt_payments p where p.gym_id=target_gym),'[]')) into snapshot;
 return snapshot;
end $$;
revoke all on function public.get_fallback_snapshot(uuid) from public,anon;
grant execute on function public.get_fallback_snapshot(uuid) to authenticated;

create or replace function public.begin_secondary_sync(target_gym uuid,target_destination text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid=gen_random_uuid(); acquired uuid; claimed jsonb;
begin
 if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
 if target_destination not in ('google_sheets','fingerprint') then raise exception 'Invalid sync destination'; end if;
 insert into public.secondary_sync_leases(gym_id,destination,lease_id,expires_at)
 values(target_gym,target_destination,token,clock_timestamp()+interval '30 minutes')
 on conflict(gym_id,destination) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at
 where public.secondary_sync_leases.expires_at<clock_timestamp() returning lease_id into acquired;
 if acquired is null then return jsonb_build_object('busy',true); end if;
 -- Jobs from a crashed worker become available after its lease expires.
 update public.sync_jobs set status='failed',locked_at=null,lease_id=null
 where gym_id=target_gym and destination=target_destination and status='processing';
 if target_destination='fingerprint' then
   -- Daily checks keep expiry restrictions current without reading Sheets.
   insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
   select target_gym,'fingerprint','access.daily','daily:'||(now() at time zone 'Asia/Kolkata')::date::text||':'||m.id::text,jsonb_build_object('member_id',m.id)
   from public.members m where m.gym_id=target_gym and m.device_user_id is not null
   on conflict(gym_id,destination,deduplication_key) do nothing;
 end if;
 with candidates as (
  select id from public.sync_jobs
  where gym_id=target_gym and destination=target_destination and status in ('pending','failed') and available_at<=clock_timestamp()
   and ((target_destination='fingerprint' and event_type in ('membership.saved','member.updated','access.daily'))
     or (target_destination='google_sheets' and event_type in ('membership.saved','payment.recorded','member.profile','member.membership','member.payment','member.pt','member.pt_payment')))
  order by case when event_type='access.daily' then 1 else 0 end,created_at,id
  limit case when target_destination='fingerprint' then 10 else 1000 end for update skip locked
 ), changed as (
  update public.sync_jobs j set status='processing',attempts=attempts+1,locked_at=clock_timestamp(),lease_id=token
  from candidates c where j.id=c.id returning j.*
 ) select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into claimed from changed;
 return jsonb_build_object('busy',false,'lease_id',token,'jobs',claimed,'snapshot',public.get_fallback_snapshot(target_gym));
end $$;
revoke all on function public.begin_secondary_sync(uuid,text) from public,anon;
grant execute on function public.begin_secondary_sync(uuid,text) to authenticated;

create or replace function public.finish_secondary_sync(target_gym uuid,target_destination text,lease_uuid uuid,succeeded boolean,error_message text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
 perform 1 from public.secondary_sync_leases where gym_id=target_gym and destination=target_destination and lease_id=lease_uuid and expires_at>clock_timestamp() for update;
 if not found then raise exception 'Sync lease expired or was replaced. Jobs were not acknowledged.'; end if;
 update public.sync_jobs set status=case when succeeded then 'completed' else 'failed' end,
  completed_at=case when succeeded then clock_timestamp() else null end,
  available_at=case when succeeded then available_at else clock_timestamp()+interval '1 minute' end,
  last_error=case when succeeded then null else left(coalesce(error_message,'Sync failed'),1000) end,locked_at=null,lease_id=null
 where gym_id=target_gym and destination=target_destination and lease_id=lease_uuid and status='processing';
 get diagnostics changed=row_count;
 delete from public.secondary_sync_leases where gym_id=target_gym and destination=target_destination and lease_id=lease_uuid;
 return changed;
end $$;
revoke all on function public.finish_secondary_sync(uuid,text,uuid,boolean,text) from public,anon;
grant execute on function public.finish_secondary_sync(uuid,text,uuid,boolean,text) to authenticated;
commit;
select last_assigned_id as last_admission_id,last_assigned_id+1 as next_device_id from public.member_id_counters where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4';
