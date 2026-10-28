-- Run after 005 as postgres in Supabase SQL Editor. Preserves existing records.
begin;
do $$ begin
  if to_regprocedure('public.record_payment(uuid,jsonb)') is null
    or to_regprocedure('public.submit_gym_form(uuid,uuid,jsonb)') is null then
    raise exception 'Run the management and direct-forms setup before migration 006';
  end if;
end $$;
create table public.staff_form_requests (
  gym_id uuid not null references public.gyms(id), request_id uuid not null,
  action text not null, payload_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(gym_id,request_id)
);
create table public.pt_trainers (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  name text not null, is_active boolean not null default true,
  staff_id uuid, unique(gym_id,name), unique(gym_id,id),
  foreign key(gym_id,staff_id) references public.staff(gym_id,id)
);
insert into public.pt_trainers(gym_id,name)
select 'b80cd818-2abe-4a90-9027-e2ba1916aec4', name from unnest(array['Lakhan','Arif','Vishal','Atharva']) as name;
create table public.pt_contracts (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  member_id uuid not null, trainer_id uuid not null,
  package text not null check(package in ('1','2','3','custom')),
  start_date date not null, end_date date not null check(end_date>=start_date),
  total_amount numeric(12,2) not null check(total_amount>0), notes text,
  created_by uuid not null, created_at timestamptz not null default now(),
  unique(gym_id,id), foreign key(gym_id,member_id) references public.members(gym_id,id),
  foreign key(gym_id,trainer_id) references public.pt_trainers(gym_id,id),
  foreign key(gym_id,created_by) references public.staff(gym_id,id)
);
create table public.pt_payments (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  contract_id uuid not null, amount numeric(12,2) not null check(amount>0),
  payment_mode text not null check(payment_mode in ('Cash','UPI','Card','Bank Transfer')),
  paid_at timestamptz not null default now(), recorded_by uuid not null,
  foreign key(gym_id,contract_id) references public.pt_contracts(gym_id,id),
  foreign key(gym_id,recorded_by) references public.staff(gym_id,id)
);
create index pt_contracts_member_idx on public.pt_contracts(gym_id,member_id);
create index pt_payments_contract_idx on public.pt_payments(gym_id,contract_id);
do $$ declare t text; begin
  foreach t in array array['staff_form_requests','pt_trainers','pt_contracts','pt_payments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['pt_trainers','pt_contracts','pt_payments'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy staff_read on public.%I for select to authenticated using (zenith_private.staff_role(gym_id) in (''admin'',''receptionist''))',t);
  end loop;
  foreach t in array array['pt_contracts','pt_payments'] loop
    execute format('create trigger audit_management after insert or update or delete on public.%I for each row execute function zenith_private.audit_management()',t);
  end loop;
end $$;

-- All commands are atomic, tenant-scoped and repeat-safe, including payments.
create or replace function public.manage_member_form(target_gym uuid, request_uuid uuid, command text, payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.staff_form_requests; member_row public.members; period public.memberships;
  plan_uuid uuid; staff_uuid uuid; result jsonb; charge numeric; paid numeric; pt_uuid uuid;
  trainer_uuid uuid; contract public.pt_contracts; payment_uuid uuid; old_data jsonb;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then
    raise exception 'Active staff access required' using errcode='42501';
  end if;
  if request_uuid is null or payload is null or jsonb_typeof(payload)<>'object' then raise exception 'A request ID and form data are required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text||request_uuid::text,6));
  select * into previous from public.staff_form_requests where gym_id=target_gym and request_id=request_uuid;
  if found then
    if previous.action<>command or previous.payload_hash<>md5(payload::text) then raise exception 'This request was already saved with different data. Reload before making another change.'; end if;
    return previous.result;
  end if;
  select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,1));
  select * into member_row from public.members where gym_id=target_gym and id=(payload->>'member_id')::uuid and not is_archived for update;
  if member_row.id is null then raise exception 'Choose an existing active member record'; end if;
  if command='profile' then
    if payload->>'expected_name' is distinct from member_row.full_name or payload->>'expected_phone' is distinct from member_row.phone then raise exception 'Member details changed. Search again before saving.'; end if;
    if length(trim(coalesce(payload->>'full_name','')))=0 or coalesce(payload->>'phone','') !~ '^[0-9]{10,15}$' then raise exception 'Enter a full name and valid phone number'; end if;
    if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'A reason for this correction is required'; end if;
    if exists(select 1 from public.members where gym_id=target_gym and id<>member_row.id and not is_archived and phone=payload->>'phone' and phone is distinct from member_row.phone) then raise exception 'Another member uses this phone. Check the number before saving.'; end if;
    old_data=jsonb_build_object('name',member_row.full_name,'phone',member_row.phone);
    update public.members set full_name=trim(payload->>'full_name'),phone=payload->>'phone',updated_at=now() where id=member_row.id and gym_id=target_gym;
  elsif command in ('membership','payment') then
    select * into period from public.memberships where gym_id=target_gym and member_id=member_row.id and id=(payload->>'membership_id')::uuid and status='confirmed' for update;
    if period.id is null then raise exception 'Choose a confirmed membership period'; end if;
    if command='payment' then
      if coalesce(payload->>'payment_mode','') not in ('Cash','UPI','Card','Bank Transfer') then raise exception 'Choose a payment method'; end if;
      payment_uuid=public.record_payment(target_gym,payload);
    else
      if payload->>'expected_start' is distinct from period.start_date::text or payload->>'expected_end' is distinct from period.end_date::text or payload->>'expected_plan' is distinct from period.plan_id::text then raise exception 'Membership changed. Search again before saving.'; end if;
      if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'A reason for changing membership is required'; end if;
      if nullif(payload->>'start_date','') is null or nullif(payload->>'end_date','') is null or (payload->>'end_date')::date<(payload->>'start_date')::date then raise exception 'Choose valid membership dates'; end if;
      select id into plan_uuid from public.membership_plans where gym_id=target_gym and id=(payload->>'plan_id')::uuid and is_active;
      if plan_uuid is null then raise exception 'Choose an active package'; end if;
      old_data=jsonb_build_object('start_date',period.start_date,'end_date',period.end_date,'plan_id',period.plan_id);
      update public.memberships set plan_id=plan_uuid,start_date=(payload->>'start_date')::date,end_date=(payload->>'end_date')::date where gym_id=target_gym and id=period.id;
    end if;
  elsif command='pt' then
    if coalesce(payload->>'package','') not in ('1','2','3','custom') then raise exception 'Choose a PT package'; end if;
    if nullif(payload->>'start_date','') is null or nullif(payload->>'end_date','') is null or (payload->>'end_date')::date<(payload->>'start_date')::date then raise exception 'Choose valid PT dates'; end if;
    if payload->>'package'<>'custom' and (payload->>'end_date')::date<>((payload->>'start_date')::date+make_interval(months=>(payload->>'package')::integer))::date then raise exception 'PT dates do not match the selected package. Choose custom for other durations.'; end if;
    charge=(payload->>'total_amount')::numeric;paid=(payload->>'paid_amount')::numeric;
    if charge is null or charge::text in ('NaN','Infinity','-Infinity') or charge<=0 or paid is null or paid::text in ('NaN','Infinity','-Infinity') or paid<0 or paid>charge or round(charge,2)<>charge or round(paid,2)<>paid then raise exception 'Enter a positive PT price and payment within the total, with at most two decimal places'; end if;
    if paid>0 and coalesce(payload->>'payment_mode','') not in ('Cash','UPI','Card','Bank Transfer') then raise exception 'Choose a payment method'; end if;
    select id into trainer_uuid from public.pt_trainers where gym_id=target_gym and id=(payload->>'trainer_id')::uuid and is_active;
    if trainer_uuid is null then raise exception 'Choose an active trainer'; end if;
    insert into public.pt_contracts(gym_id,member_id,trainer_id,package,start_date,end_date,total_amount,notes,created_by)
    values(target_gym,member_row.id,trainer_uuid,payload->>'package',(payload->>'start_date')::date,(payload->>'end_date')::date,charge,payload->>'notes',staff_uuid) returning id into pt_uuid;
    if paid>0 then
      insert into public.pt_payments(gym_id,contract_id,amount,payment_mode,recorded_by) values(target_gym,pt_uuid,paid,payload->>'payment_mode',staff_uuid);
    end if;
  elsif command='pt_payment' then
    select * into contract from public.pt_contracts where gym_id=target_gym and member_id=member_row.id and id=(payload->>'contract_id')::uuid for update;
    if contract.id is null then raise exception 'PT record not found'; end if;
    select contract.total_amount-coalesce(sum(amount),0) into charge from public.pt_payments where gym_id=target_gym and contract_id=contract.id;
    paid=(payload->>'amount')::numeric;
    if paid is null or paid::text in ('NaN','Infinity','-Infinity') or paid<=0 or paid>charge or round(paid,2)<>paid then raise exception 'Payment must be positive and cannot exceed PT dues'; end if;
    if coalesce(payload->>'payment_mode','') not in ('Cash','UPI','Card','Bank Transfer') then raise exception 'Choose a payment method'; end if;
    insert into public.pt_payments(gym_id,contract_id,amount,payment_mode,recorded_by) values(target_gym,contract.id,paid,payload->>'payment_mode',staff_uuid) returning id into payment_uuid;
    pt_uuid=contract.id;
  else raise exception 'Unknown member form action';
  end if;
  insert into public.audit_logs(gym_id,actor_user_id,action,entity_type,entity_id,details)
  values(target_gym,auth.uid(),command,'member_form',member_row.id,jsonb_build_object('reason',coalesce(payload->>'reason',payload->>'notes'),'before',old_data,'membership_id',period.id,'pt_id',pt_uuid,'payment_id',payment_uuid));
  insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
  values(target_gym,'google_sheets','member.'||command,request_uuid::text,jsonb_build_object('member_id',member_row.id,'membership_id',period.id,'pt_id',pt_uuid,'payment_id',payment_uuid));
  if command in ('profile','membership') then
    insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
    values(target_gym,'fingerprint','member.updated',request_uuid::text,jsonb_build_object('member_id',member_row.id));
  end if;
  result=jsonb_build_object('success',true,'memberId',member_row.id,'ptId',pt_uuid,'savedTo','supabase','secondarySync','queued');
  insert into public.staff_form_requests(gym_id,request_id,action,payload_hash,result) values(target_gym,request_uuid,command,md5(payload::text),result);
  return result;
end $$;
revoke all on function public.manage_member_form(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.manage_member_form(uuid,uuid,text,jsonb) to authenticated;
commit;
select 'Member update and Personal Training setup ready' as result;
