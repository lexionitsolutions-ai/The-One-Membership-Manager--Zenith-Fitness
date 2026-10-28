-- Run after 006 in Supabase SQL Editor. Existing payment rows are unchanged.
begin;
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
    select greatest(coalesce(max(device_user_id),0),660)+1 into last_id from public.members where gym_id=target_gym;
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

-- Separate endpoint prevents an older database from accepting a mixed payment
-- as one ambiguous ledger entry before this migration has been applied.
create or replace function public.submit_split_gym_form(target_gym uuid,request_uuid uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if payload->>'payment_mode' is distinct from 'Cash + Online' then raise exception 'Choose Cash + Online'; end if;
  return public.submit_gym_form(target_gym,request_uuid,payload);
end $$;
revoke all on function public.submit_split_gym_form(uuid,uuid,jsonb) from public,anon;
grant execute on function public.submit_split_gym_form(uuid,uuid,jsonb) to authenticated;
commit;
select 'Cash + Online admission and renewal payments ready' as result;
