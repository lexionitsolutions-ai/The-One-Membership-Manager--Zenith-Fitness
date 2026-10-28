-- Run as postgres. Account and gym role are created in the SAME transaction.
-- Only the server's Supabase admin API can supply raw_app_meta_data.
begin;
create or replace function zenith_private.create_staff_for_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare provision jsonb;
begin
  provision=new.raw_app_meta_data->'zenith_staff';
  if provision is null then return new; end if;
  if tg_op='UPDATE' then
    if provision is not distinct from old.raw_app_meta_data->'zenith_staff' then return new; end if;
  end if;
  if exists(select 1 from public.staff where gym_id=(provision->>'gym_id')::uuid and user_id=new.id) then return new; end if;
  if provision->>'role' is null or provision->>'role' not in ('admin','receptionist','trainer')
    or length(trim(coalesce(provision->>'full_name','')))=0 then
    raise exception 'Invalid staff account details';
  end if;
  insert into public.staff(gym_id,user_id,full_name,role,is_active)
  values((provision->>'gym_id')::uuid,new.id,trim(provision->>'full_name'),provision->>'role',true);
  return new;
end $$;
revoke all on function zenith_private.create_staff_for_auth_user() from public,anon,authenticated;
drop trigger if exists zenith_create_staff_account on auth.users;
create trigger zenith_create_staff_account after insert or update of raw_app_meta_data on auth.users
for each row execute function zenith_private.create_staff_for_auth_user();

create or replace function public.staff_account_setup_ready(target_gym uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if zenith_private.staff_role(target_gym) is distinct from 'admin' then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='auth.users'::regclass
    and tgname='zenith_create_staff_account' and tgenabled='O' and not tgisinternal) then
    raise exception 'Staff account creation is not configured';
  end if;
  return true;
end $$;
revoke all on function public.staff_account_setup_ready(uuid) from public,anon;
grant execute on function public.staff_account_setup_ready(uuid) to authenticated;
commit;
