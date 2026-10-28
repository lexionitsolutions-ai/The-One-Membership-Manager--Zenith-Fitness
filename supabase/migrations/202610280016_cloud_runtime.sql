-- Run once as postgres before deploying to Vercel. No membership/payment edits.
begin;
create table if not exists public.portal_runtime (
 key text primary key,encrypted_value text not null,
 updated_at timestamptz not null default now(),lock_token uuid,lock_until timestamptz
);
create table if not exists public.bridge_status (
 gym_id uuid primary key references public.gyms(id),last_seen timestamptz not null default now()
);
create table if not exists public.bridge_requests (
 id uuid primary key default gen_random_uuid(),gym_id uuid not null references public.gyms(id),
 requested_by uuid not null references auth.users(id),
 kind text not null check(kind in ('fingerprint_date_sync','attendance_refresh','secondary_sync')),
 payload jsonb not null default '{}'::jsonb,deduplication_key text not null,
 status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes',
 started_at timestamptz,completed_at timestamptz,worker_token uuid,result jsonb,error text
);
create unique index if not exists bridge_active_request on public.bridge_requests(gym_id,deduplication_key) where status in ('queued','processing');
create index if not exists bridge_queue on public.bridge_requests(gym_id,status,created_at);
do $$ declare t text; begin
 foreach t in array array['portal_runtime','bridge_status','bridge_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
create or replace function public.claim_portal_runtime_lock(entry_key text,lease_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 update public.portal_runtime set lock_token=lease_token,lock_until=now()+interval '60 seconds'
 where key=entry_key and (lock_until is null or lock_until<now());
 get diagnostics affected=row_count;return affected=1;
end $$;
create or replace function public.enqueue_bridge_request(target_gym uuid,actor uuid,request_kind text,request_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare request_id uuid; dedupe text;
begin
 if not exists(select 1 from public.staff where gym_id=target_gym and user_id=actor and is_active
   and role=any(case when request_kind='attendance_refresh' then array['admin','receptionist'] else array['admin'] end)) then
   raise exception 'Staff access required' using errcode='42501';
 end if;
 if request_kind not in ('fingerprint_date_sync','attendance_refresh','secondary_sync') then raise exception 'Invalid bridge request'; end if;
 dedupe=request_kind||':'||md5(request_payload::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_gym::text||dedupe,19));
 update public.bridge_requests set status='failed',error='Request expired before the gym bridge completed it',completed_at=now()
 where gym_id=target_gym and status in ('queued','processing') and expires_at<now();
 select id into request_id from public.bridge_requests where gym_id=target_gym and deduplication_key=dedupe and status in ('queued','processing');
 if request_id is null then
  insert into public.bridge_requests(gym_id,requested_by,kind,payload,deduplication_key)
  values(target_gym,actor,request_kind,request_payload,dedupe) returning id into request_id;
 end if;
 return request_id;
end $$;
create or replace function public.claim_bridge_request(target_gym uuid,lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.bridge_requests;
begin
 update public.bridge_requests set status='failed',error='The gym bridge did not finish before the request expired',completed_at=now()
 where gym_id=target_gym and status in ('queued','processing') and expires_at<now();
 select * into item from public.bridge_requests where gym_id=target_gym and status='queued' and expires_at>now()
 order by created_at for update skip locked limit 1;
 if item.id is null then return null; end if;
 update public.bridge_requests set status='processing',started_at=now(),worker_token=lease_token,expires_at=now()+interval '30 minutes'
 where id=item.id returning * into item;
 return to_jsonb(item);
end $$;
revoke all on function public.claim_portal_runtime_lock(text,uuid),public.enqueue_bridge_request(uuid,uuid,text,jsonb),public.claim_bridge_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_portal_runtime_lock(text,uuid),public.enqueue_bridge_request(uuid,uuid,text,jsonb),public.claim_bridge_request(uuid,uuid) to service_role;
commit;
select 'Cloud session storage and local bridge queue are ready' as result;
