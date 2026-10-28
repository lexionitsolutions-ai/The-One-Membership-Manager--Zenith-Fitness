-- Run in Supabase SQL Editor after the initial schema migration.
-- The user must already exist in Authentication > Users.
-- This assigns the app role only; client access policies are a separate step.
insert into public.staff (gym_id, user_id, full_name, role, is_active)
values (
  'b80cd818-2abe-4a90-9027-e2ba1916aec4',
  '3cf3542d-3425-4b52-991a-858d4c4da6a1',
  'Zenith Admin',
  'admin',
  true
)
on conflict (gym_id, user_id)
do update set role = 'admin', is_active = true
returning user_id, full_name, role, is_active;
