-- Run as postgres AFTER manually creating the Supabase Authentication user:
-- Email: 7875692761@staff.zenith.local, Auto Confirm enabled.
-- Enter the chosen password only in Supabase Authentication, not in this file.
begin;
do $$
declare reception_user uuid; gym uuid='b80cd818-2abe-4a90-9027-e2ba1916aec4';
begin
 select id into reception_user from auth.users where lower(email)='7875692761@staff.zenith.local';
 if reception_user is null then raise exception 'Create 7875692761@staff.zenith.local under Supabase Authentication first'; end if;
 if exists(select 1 from public.staff where gym_id=gym and user_id=reception_user and role<>'receptionist') then raise exception 'This login already has a different staff role. Review it before changing access.'; end if;
 insert into public.staff(gym_id,user_id,full_name,role,is_active)
 values(gym,reception_user,'Zenith Reception','receptionist',true)
 on conflict(gym_id,user_id) do update set full_name='Zenith Reception',is_active=true;
end $$;
commit;
select s.full_name,s.role,s.is_active,'7875692761' as login_username
from public.staff s join auth.users u on u.id=s.user_id
where s.gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' and lower(u.email)='7875692761@staff.zenith.local';
