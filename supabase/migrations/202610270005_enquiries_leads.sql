-- Run once after management setup (003). No source Google Sheet is modified.
begin;
alter table public.enquiries alter column phone drop not null;
alter table public.enquiries add column if not exists email text;
alter table public.enquiries add column if not exists address text;
alter table public.enquiries add column if not exists source text;
alter table public.enquiries add column if not exists legacy_status text;
alter table public.enquiries add column if not exists lead_status text not null default 'Pending';
alter table public.enquiries add column if not exists next_follow_up_date date;
alter table public.enquiries add column if not exists remark text;
alter table public.enquiries add column if not exists needs_review boolean not null default false;
update public.enquiries set lead_status=case status when 'converted' then 'Admission Done' when 'closed' then 'Not Interested' when 'contacted' then 'Call Done' else 'Pending' end;
create unique index if not exists enquiries_gym_identity on public.enquiries(gym_id,id);
create table public.enquiry_submissions(
  gym_id uuid not null references public.gyms(id),request_id uuid not null,payload_hash text not null,
  enquiry_id uuid not null,primary key(gym_id,request_id),foreign key(gym_id,enquiry_id) references public.enquiries(gym_id,id)
);
create table public.enquiry_followups(
  id uuid primary key default gen_random_uuid(),gym_id uuid not null references public.gyms(id),
  enquiry_id uuid not null,actor_user_id uuid not null,from_status text,to_status text not null,
  next_follow_up_date date,remark text,created_at timestamptz not null default now(),
  foreign key(gym_id,enquiry_id) references public.enquiries(gym_id,id)
);
alter table public.enquiry_submissions enable row level security;
alter table public.enquiry_followups enable row level security;
revoke all on public.enquiry_submissions,public.enquiry_followups from public,anon,authenticated;
grant select on public.enquiry_followups to authenticated;
grant select,insert,update,delete on public.enquiry_submissions,public.enquiry_followups to service_role;
create policy followup_staff_read on public.enquiry_followups for select to authenticated using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
create index enquiry_due_dates on public.enquiries(gym_id,next_follow_up_date,follow_up_date);

create function public.submit_enquiry(target_gym uuid,request_uuid uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lead_uuid uuid; prior_hash text; fingerprint text=md5(payload::text); contact text;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
  if request_uuid is null then raise exception 'Request ID required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text||request_uuid::text,5));
  select enquiry_id,payload_hash into lead_uuid,prior_hash from public.enquiry_submissions where gym_id=target_gym and request_id=request_uuid;
  if lead_uuid is not null then
    if prior_hash<>fingerprint then raise exception 'This request was already saved. Reload the form for another enquiry.'; end if;
  else
    contact=regexp_replace(coalesce(payload->>'phone',''),'[^0-9]','','g');
    if length(trim(coalesce(payload->>'full_name','')))=0 or contact !~ '^[0-9]{10,15}$' then raise exception 'Enter a name and valid phone number'; end if;
    insert into public.enquiries(gym_id,full_name,phone,email,address,interested_plan,source,follow_up_date,notes,status,lead_status)
    values(target_gym,trim(payload->>'full_name'),contact,nullif(payload->>'email',''),nullif(payload->>'address',''),nullif(payload->>'interested_plan',''),
      nullif(payload->>'source',''),nullif(payload->>'follow_up_date','')::date,nullif(payload->>'notes',''),'new','Pending') returning id into lead_uuid;
    insert into public.enquiry_submissions values(target_gym,request_uuid,fingerprint,lead_uuid);
    insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
    values(target_gym,'google_sheets','enquiry.created',lead_uuid::text,jsonb_build_object('enquiry_id',lead_uuid));
  end if;
  return jsonb_build_object('success',true,'enquiryId',lead_uuid,'savedTo','supabase');
end $$;

create function public.update_enquiry_followup(target_gym uuid,target_lead uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_status text; new_status text=payload->>'lead_status'; base_status text;
begin
  if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
  if new_status is null or new_status not in ('Pending','Call Done','WhatsApp Sent','Trial Done','Admission Done','Call Later','Not Interested','Wrong Number') then raise exception 'Choose a valid lead status'; end if;
  select lead_status into prior_status from public.enquiries where gym_id=target_gym and id=target_lead for update;
  if not found then raise exception 'Enquiry not found'; end if;
  base_status=case new_status when 'Admission Done' then 'converted' when 'Not Interested' then 'closed' when 'Wrong Number' then 'closed' when 'Pending' then 'new' else 'contacted' end;
  update public.enquiries set lead_status=new_status,status=base_status,next_follow_up_date=nullif(payload->>'next_follow_up_date','')::date,remark=payload->>'remark'
  where gym_id=target_gym and id=target_lead;
  insert into public.enquiry_followups(gym_id,enquiry_id,actor_user_id,from_status,to_status,next_follow_up_date,remark)
  values(target_gym,target_lead,auth.uid(),prior_status,new_status,nullif(payload->>'next_follow_up_date','')::date,payload->>'remark');
  insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
  values(target_gym,'google_sheets','enquiry.updated',gen_random_uuid()::text,jsonb_build_object('enquiry_id',target_lead));
  return jsonb_build_object('success',true);
end $$;

create function public.import_enquiry_snapshot(target_gym uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; imported integer=0; changed integer;
begin
  if zenith_private.staff_role(target_gym) is distinct from 'admin' then raise exception 'Admin access required' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(payload->'leads') loop
    insert into public.enquiries(gym_id,full_name,phone,email,address,interested_plan,source,follow_up_date,next_follow_up_date,notes,remark,status,lead_status,legacy_status,needs_review,source_key,created_at)
    values(target_gym,item->>'full_name',item->>'phone',item->>'email',item->>'address',item->>'interested_plan',item->>'source',
      nullif(item->>'follow_up_date','')::date,nullif(item->>'next_follow_up_date','')::date,item->>'notes',item->>'remark',item->>'status',item->>'lead_status',item->>'legacy_status',
      coalesce((item->>'needs_review')::boolean,false),item->>'source_key',(item->>'created_at')::timestamptz) on conflict(gym_id,source_key) do nothing;
    get diagnostics changed=row_count;imported=imported+changed;
  end loop;
  return jsonb_build_object('success',true,'imported',imported);
end $$;

create function public.reconcile_pending_snapshot(target_gym uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; period public.memberships; updated integer=0;
begin
  if zenith_private.staff_role(target_gym) is distinct from 'admin' then raise exception 'Admin access required' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(payload->'balances') loop
    if (item->>'amount_paid')::numeric<0 or (item->>'pending_amount')::numeric<=0 then raise exception 'Invalid pending balance snapshot'; end if;
    for period in select p.* from public.memberships p join public.members m on m.id=p.member_id and m.gym_id=p.gym_id
      where p.gym_id=target_gym and m.admission_id=item->>'admission_id' and p.end_date=(item->>'end_date')::date
        and not p.accounting_verified and p.status='confirmed'
        and coalesce(p.final_amount,p.historical_charge)=(item->>'amount_paid')::numeric+(item->>'pending_amount')::numeric
      for update of p loop
      if not exists(select 1 from public.payments where gym_id=target_gym and membership_id=period.id) then
        update public.memberships set opening_paid_amount=(item->>'amount_paid')::numeric,accounting_verified=true where id=period.id and gym_id=target_gym;
        updated=updated+1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('success',true,'reconciled',updated);
end $$;
revoke all on function public.submit_enquiry(uuid,uuid,jsonb),public.update_enquiry_followup(uuid,uuid,jsonb),public.import_enquiry_snapshot(uuid,jsonb),public.reconcile_pending_snapshot(uuid,jsonb) from public,anon;
grant execute on function public.submit_enquiry(uuid,uuid,jsonb),public.update_enquiry_followup(uuid,uuid,jsonb),public.import_enquiry_snapshot(uuid,jsonb),public.reconcile_pending_snapshot(uuid,jsonb) to authenticated;
revoke insert,update on public.enquiries from authenticated;
commit;
