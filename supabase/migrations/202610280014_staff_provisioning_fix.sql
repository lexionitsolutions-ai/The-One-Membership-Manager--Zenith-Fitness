-- Repair Auth metadata timing for installations that already ran 013.
-- Existing staff roles and passwords are preserved.
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

commit;
