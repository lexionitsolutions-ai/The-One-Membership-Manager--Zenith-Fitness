-- Run after 013 as postgres. All temporary Auth/staff rows are rolled back.
begin;
insert into public.gyms(id,name)
values('fa000000-0000-4000-8000-000000000131','Temporary staff account test');
insert into auth.users(id,email,raw_app_meta_data)
values('fa000000-0000-4000-8000-000000000132','__staff_account_test__@staff.zenith.local',
 '{"zenith_staff":{"gym_id":"fa000000-0000-4000-8000-000000000131","full_name":"Temporary Reception","role":"receptionist"}}');
insert into auth.users(id,email,raw_user_meta_data)
values('fa000000-0000-4000-8000-000000000133','__untrusted_staff_test__@staff.zenith.local',
 '{"zenith_staff":{"gym_id":"fa000000-0000-4000-8000-000000000131","full_name":"Untrusted","role":"admin"}}');
insert into auth.users(id,email) values('fa000000-0000-4000-8000-000000000135','__late_metadata_test__@staff.zenith.local');
update auth.users set raw_app_meta_data='{"zenith_staff":{"gym_id":"fa000000-0000-4000-8000-000000000131","full_name":"Late metadata trainer","role":"trainer"}}'
where id='fa000000-0000-4000-8000-000000000135';
do $$ begin
 if not exists(select 1 from public.staff where user_id='fa000000-0000-4000-8000-000000000135' and role='trainer') then
   raise exception 'FAIL: metadata applied after Auth insertion did not assign staff';
 end if;
 if not exists(select 1 from public.staff where user_id='fa000000-0000-4000-8000-000000000132'
   and gym_id='fa000000-0000-4000-8000-000000000131' and role='receptionist' and is_active) then
   raise exception 'FAIL: account role was not assigned';
 end if;
 if exists(select 1 from public.staff where user_id='fa000000-0000-4000-8000-000000000133') then
   raise exception 'FAIL: untrusted signup metadata granted staff access';
 end if;
 begin
   insert into auth.users(id,email,raw_app_meta_data)
   values('fa000000-0000-4000-8000-000000000134','__invalid_staff_test__@staff.zenith.local',
    '{"zenith_staff":{"gym_id":"fa000000-0000-4000-8000-000000000131","full_name":"Invalid","role":"owner"}}');
   raise exception 'FAIL: invalid role accepted';
 exception when raise_exception then
   if sqlerrm<>'Invalid staff account details' then raise; end if;
 end;
 if exists(select 1 from auth.users where id='fa000000-0000-4000-8000-000000000134') then
   raise exception 'FAIL: failed role creation retained an Auth account';
 end if;
end $$;
rollback;
select 'PASS: atomic account role creation, untrusted metadata isolation and failure rollback' as result;
