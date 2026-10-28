-- Management modules. Run through the generated real-data setup file.
begin;
alter table public.members alter column phone drop not null;
alter table public.members add column if not exists needs_review boolean not null default false;
alter table public.memberships add column if not exists opening_paid_amount numeric(12,2);
alter table public.memberships add column if not exists accounting_verified boolean not null default true;
alter table public.memberships add column if not exists purchased_at timestamptz;
alter table public.memberships alter column total_amount drop not null;
alter table public.memberships alter column discount_amount drop not null;
alter table public.memberships add column if not exists historical_charge numeric(12,2) check(historical_charge>=0);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  expense_date date not null, category text not null, description text not null,
  amount numeric(12,2) not null check(amount > 0), payment_mode text not null,
  status text not null default 'recorded' check(status in ('recorded','void')),
  created_by uuid, created_at timestamptz not null default now(),
  foreign key(gym_id,created_by) references public.staff(gym_id,id)
);
create table if not exists public.historical_receipts (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  received_at timestamptz not null, description text, transaction_type text,
  amount numeric(12,2) not null check(amount >= 0), payment_mode text,
  source_key text not null, unique(gym_id,source_key)
);
create table if not exists public.migration_records (
  id uuid primary key default gen_random_uuid(), gym_id uuid not null references public.gyms(id),
  source_key text not null, sheet_name text not null, row_number integer not null,
  raw_data jsonb not null, import_status text not null, unique(gym_id,source_key)
);
alter table public.expenses enable row level security;
alter table public.historical_receipts enable row level security;
alter table public.migration_records enable row level security;
revoke all on public.expenses,public.historical_receipts,public.migration_records from public,anon,authenticated;
grant select,insert,update on public.expenses to authenticated;
grant select on public.historical_receipts,public.migration_records to authenticated;
grant select,insert,update,delete on public.expenses,public.historical_receipts,public.migration_records to service_role;
create policy expense_read on public.expenses for select to authenticated using(zenith_private.staff_role(gym_id)='admin');
create policy expense_insert on public.expenses for insert to authenticated with check(zenith_private.staff_role(gym_id)='admin');
create policy expense_update on public.expenses for update to authenticated using(zenith_private.staff_role(gym_id)='admin') with check(zenith_private.staff_role(gym_id)='admin');
create policy receipt_read on public.historical_receipts for select to authenticated using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
create policy migration_read on public.migration_records for select to authenticated using(zenith_private.staff_role(gym_id)='admin');

-- Serialize admin changes per gym and preserve at least one active administrator.
create function zenith_private.protect_last_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.gym_id::text,0));
  if old.role='admin' and old.is_active then
    if tg_op='DELETE' or new.role<>'admin' or not new.is_active or new.gym_id<>old.gym_id or new.user_id<>old.user_id then
      if not exists(select 1 from public.staff where gym_id=old.gym_id and id<>old.id and role='admin' and is_active) then
        raise exception 'The last active administrator cannot be removed or disabled.';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function zenith_private.protect_last_admin() from public,anon,authenticated;
create trigger protect_last_admin before update or delete on public.staff
for each row execute function zenith_private.protect_last_admin();

-- Record management changes within the same transaction as the write.
create function zenith_private.audit_management() returns trigger
language plpgsql security definer set search_path='' as $$
declare record_data jsonb;
begin
  record_data=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_logs(gym_id,actor_user_id,action,entity_type,entity_id,details)
  values((record_data->>'gym_id')::uuid,auth.uid(),lower(tg_op),tg_table_name,
    (record_data->>'id')::uuid,jsonb_build_object('operation',tg_op));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function zenith_private.audit_management() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['staff','members','memberships','payments','expenses','enquiries'] loop
    execute format('create trigger audit_management after insert or update or delete on public.%I for each row execute function zenith_private.audit_management()',t);
  end loop;
end $$;

-- Atomic admission/renewal creation; every permission is checked inside the RPC.
create function public.save_membership(target_gym uuid, payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare member_uuid uuid; membership_uuid uuid; plan_uuid uuid; last_id integer;
  total numeric; discount numeric; paid numeric; member_code text; staff_uuid uuid;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
  select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,1));
  total=(payload->>'total_amount')::numeric; discount=coalesce((payload->>'discount_amount')::numeric,0); paid=coalesce((payload->>'paid_amount')::numeric,0);
  if total is null or total<0 or discount<0 or discount>total or paid<0 or paid>total-discount then raise exception 'Invalid charge, discount, or payment'; end if;
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
  if paid>0 then
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

create function public.record_payment(target_gym uuid,payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.memberships; amount_paid numeric; balance numeric; payment_uuid uuid; staff_uuid uuid;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
  select * into m from public.memberships where gym_id=target_gym and id=(payload->>'membership_id')::uuid for update;
  if m.id is null or m.status<>'confirmed' or not m.accounting_verified then raise exception 'Choose a confirmed membership with reconciled accounting'; end if;
  amount_paid=(payload->>'amount')::numeric;
  select coalesce(m.final_amount,m.historical_charge)-coalesce(m.opening_paid_amount,0)-coalesce(sum(case when kind='refund' then -amount else amount end),0)
    into balance from public.payments where membership_id=m.id and gym_id=target_gym;
  if amount_paid is null or amount_paid<=0 or amount_paid>balance then raise exception 'Payment must be positive and cannot exceed the outstanding balance'; end if;
  select id into staff_uuid from public.staff where gym_id=target_gym and user_id=auth.uid() and is_active;
  insert into public.payments(gym_id,membership_id,amount,payment_mode,paid_at,recorded_by)
  values(target_gym,m.id,amount_paid,coalesce(nullif(payload->>'payment_mode',''),'Cash'),now(),staff_uuid) returning id into payment_uuid;
  insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
  values(target_gym,'google_sheets','payment.recorded',payment_uuid::text,jsonb_build_object('payment_id',payment_uuid));
  return payment_uuid;
end $$;
revoke all on function public.record_payment(uuid,jsonb) from public,anon;
grant execute on function public.record_payment(uuid,jsonb) to authenticated;
-- Financial writes must use the atomic validation functions above.
revoke insert,update on public.memberships from authenticated;
revoke insert on public.payments from authenticated;

-- Used by the signed-in administrator to import the prepared local snapshot.
-- One transaction, tenant-scoped, insert-only and repeat-safe by UUID/source key.
create function public.import_gym_snapshot(target_gym uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; imported_members integer=0; imported_periods integer=0; imported_receipts integer=0; changed integer;
begin
  if zenith_private.staff_role(target_gym) is distinct from 'admin' then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text,2));
  if coalesce(payload->'source'->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'A source snapshot hash is required'; end if;
  if exists(select 1 from public.migration_records where gym_id=target_gym and sheet_name='__snapshot__' and raw_data->>'sha256'<>payload->'source'->>'sha256') then
    raise exception 'A different snapshot was already imported. Reconcile changes before importing another export.';
  end if;
  if exists(select 1 from public.migration_records where gym_id=target_gym and source_key='snapshot:'||(payload->'source'->>'sha256')) then
    return jsonb_build_object('members',0,'membership_periods',0,'cashbook_receipts',0);
  end if;
  for item in select value from jsonb_array_elements(payload->'members') loop
    insert into public.members(id,gym_id,admission_id,device_user_id,full_name,phone,gender,category,is_archived,needs_review,created_at)
    values((item->>'id')::uuid,target_gym,item->>'admission_id',(item->>'device_user_id')::integer,item->>'full_name',item->>'phone',item->>'gender',item->>'category',false,coalesce((item->>'needs_review')::boolean,false),(item->>'created_at')::timestamptz)
    on conflict do nothing;
    get diagnostics changed=row_count;imported_members=imported_members+changed;
  end loop;
  for item in select value from jsonb_array_elements(payload->'privateDetails') loop
    insert into public.member_private_details(gym_id,member_id,address,medical_history,remarks)
    values(target_gym,(item->>'member_id')::uuid,item->>'address',item->>'medical_history',item->>'remarks') on conflict do nothing;
  end loop;
  for item in select value from jsonb_array_elements(payload->'memberships') loop
    insert into public.memberships(id,gym_id,member_id,plan_id,kind,start_date,end_date,status,total_amount,discount_amount,historical_charge,opening_paid_amount,accounting_verified,purchased_at,source_key)
    select (item->>'id')::uuid,target_gym,(item->>'member_id')::uuid,p.id,item->>'kind',(item->>'start_date')::date,(item->>'end_date')::date,'confirmed',
      (item->>'total_amount')::numeric,(item->>'discount_amount')::numeric,(item->>'historical_charge')::numeric,(item->>'opening_paid_amount')::numeric,
      (item->>'accounting_verified')::boolean,(item->>'purchased_at')::timestamptz,item->>'source_key'
    from public.membership_plans p where p.gym_id=target_gym and p.code=item->>'plan_code'
    on conflict do nothing;
    get diagnostics changed=row_count;imported_periods=imported_periods+changed;
  end loop;
  for item in select value from jsonb_array_elements(payload->'historicalReceipts') loop
    insert into public.historical_receipts(id,gym_id,received_at,description,transaction_type,amount,payment_mode,source_key)
    values((item->>'id')::uuid,target_gym,(item->>'received_at')::timestamptz,item->>'description',item->>'transaction_type',(item->>'amount')::numeric,item->>'payment_mode',item->>'source_key') on conflict do nothing;
    get diagnostics changed=row_count;imported_receipts=imported_receipts+changed;
  end loop;
  for item in select value from jsonb_array_elements(payload->'reviewRecords') loop
    insert into public.migration_records(gym_id,source_key,sheet_name,row_number,raw_data,import_status)
    values(target_gym,item->>'source_key',item->>'sheet_name',(item->>'row_number')::integer,item->'raw_data','needs_review') on conflict do nothing;
  end loop;
  insert into public.migration_records(gym_id,source_key,sheet_name,row_number,raw_data,import_status)
  values(target_gym,'snapshot:'||(payload->'source'->>'sha256'),'__snapshot__',0,payload->'source','import_manifest');
  return jsonb_build_object('members',imported_members,'membership_periods',imported_periods,'cashbook_receipts',imported_receipts);
end $$;
revoke all on function public.import_gym_snapshot(uuid,jsonb) from public,anon;
grant execute on function public.import_gym_snapshot(uuid,jsonb) to authenticated;
commit;
