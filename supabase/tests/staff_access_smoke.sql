-- Run AFTER the staff access migration, as the SQL Editor's postgres role.
-- Uses your existing admin account to simulate each role inside a transaction.
-- ALL fixtures and temporary role changes are rolled back at the end.
-- If any statement fails, run ROLLBACK; before retrying in the same session.
begin;

do $$ begin
  if not exists (select 1 from public.staff
    where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4'
      and user_id = '3cf3542d-3425-4b52-991a-858d4c4da6a1'
      and role = 'admin' and is_active) then
    raise exception 'Create the first active admin before running these tests';
  end if;
end $$;

insert into public.gyms(id, name)
values ('fa000000-0000-4000-8000-000000000001', 'Temporary access test gym');
insert into public.members(id, gym_id, admission_id, full_name, phone) values
  ('fa000000-0000-4000-8000-000000000011', 'b80cd818-2abe-4a90-9027-e2ba1916aec4', '__rls_test_assigned__', 'Test assigned', 'test-only'),
  ('fa000000-0000-4000-8000-000000000012', 'b80cd818-2abe-4a90-9027-e2ba1916aec4', '__rls_test_unassigned__', 'Test unassigned', 'test-only'),
  ('fa000000-0000-4000-8000-000000000013', 'fa000000-0000-4000-8000-000000000001', '__rls_test_other_gym__', 'Test other gym', 'test-only');
insert into public.member_private_details(gym_id, member_id, medical_history)
values ('b80cd818-2abe-4a90-9027-e2ba1916aec4', 'fa000000-0000-4000-8000-000000000011', 'test-only');
insert into public.memberships(id, gym_id, member_id, plan_id, kind, start_date, end_date, total_amount)
select 'fa000000-0000-4000-8000-000000000021', gym_id,
  'fa000000-0000-4000-8000-000000000011', id, 'admission', current_date, current_date + 30, 100
from public.membership_plans where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4' and code = '30';
insert into public.payments(gym_id, membership_id, amount, payment_mode, paid_at)
values ('b80cd818-2abe-4a90-9027-e2ba1916aec4', 'fa000000-0000-4000-8000-000000000021', 100, 'test', now());
insert into public.attendance(gym_id, member_id, device_user_id, device_identifier, punched_at, source_key)
values
  ('b80cd818-2abe-4a90-9027-e2ba1916aec4', 'fa000000-0000-4000-8000-000000000011', 'test', 'test', now(), '__rls_test_assigned__'),
  ('b80cd818-2abe-4a90-9027-e2ba1916aec4', 'fa000000-0000-4000-8000-000000000012', 'test', 'test', now(), '__rls_test_unassigned__');

select set_config('request.jwt.claim.sub', '3cf3542d-3425-4b52-991a-858d4c4da6a1', true);
select set_config('request.jwt.claims', '{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.members where id in (
    'fa000000-0000-4000-8000-000000000011', 'fa000000-0000-4000-8000-000000000012',
    'fa000000-0000-4000-8000-000000000013')) <> 2 then
    raise exception 'FAIL: admin own-gym visibility or cross-gym isolation';
  end if;
  if (select count(*) from public.payments where membership_id = 'fa000000-0000-4000-8000-000000000021') <> 1 then
    raise exception 'FAIL: admin payment visibility';
  end if;
  begin
    delete from public.payments where membership_id = 'fa000000-0000-4000-8000-000000000021';
    raise exception 'FAIL: browser payment deletion was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

update public.staff set role = 'receptionist'
where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4'
  and user_id = '3cf3542d-3425-4b52-991a-858d4c4da6a1';
set local role authenticated;
do $$ declare changed integer; begin
  if (select count(*) from public.payments where membership_id = 'fa000000-0000-4000-8000-000000000021') <> 1 then
    raise exception 'FAIL: receptionist payment visibility';
  end if;
  insert into public.members(gym_id, admission_id, full_name, phone)
  values ('b80cd818-2abe-4a90-9027-e2ba1916aec4', '__rls_test_new__', 'Test admission', 'test-only');
  insert into public.payments(gym_id, membership_id, amount, payment_mode, paid_at, recorded_by)
  select gym_id, 'fa000000-0000-4000-8000-000000000021', 1, 'test', now(), id
  from public.staff where user_id = (select auth.uid())
    and gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4';
  update public.staff set role = 'admin' where user_id = (select auth.uid());
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: receptionist self-promotion'; end if;
  begin
    insert into public.members(gym_id, admission_id, full_name, phone)
    values ('fa000000-0000-4000-8000-000000000001', '__rls_test_forbidden__', 'Forbidden', 'test-only');
    raise exception 'FAIL: cross-gym insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

update public.staff set role = 'trainer'
where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4'
  and user_id = '3cf3542d-3425-4b52-991a-858d4c4da6a1';
insert into public.trainer_assignments(gym_id, trainer_id, member_id)
select gym_id, id, 'fa000000-0000-4000-8000-000000000011' from public.staff
where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4'
  and user_id = '3cf3542d-3425-4b52-991a-858d4c4da6a1';
set local role authenticated;
do $$ begin
  if (select count(*) from public.members where admission_id like '__rls_test_%') <> 1 then
    raise exception 'FAIL: trainer must see only assigned test member';
  end if;
  if (select count(*) from public.attendance where source_key like '__rls_test_%') <> 1 then
    raise exception 'FAIL: trainer attendance isolation';
  end if;
  if exists (select 1 from public.payments)
    or exists (select 1 from public.memberships)
    or exists (select 1 from public.member_private_details)
    or exists (select 1 from public.audit_logs)
    or exists (select 1 from public.sync_jobs) then
    raise exception 'FAIL: trainer can read protected data';
  end if;
  begin
    insert into public.members(gym_id, admission_id, full_name, phone)
    values ('b80cd818-2abe-4a90-9027-e2ba1916aec4', '__rls_test_forbidden__', 'Forbidden', 'test-only');
    raise exception 'FAIL: trainer member insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

update public.staff set is_active = false
where gym_id = 'b80cd818-2abe-4a90-9027-e2ba1916aec4'
  and user_id = '3cf3542d-3425-4b52-991a-858d4c4da6a1';
set local role authenticated;
do $$ begin
  if exists (select 1 from public.members where admission_id like '__rls_test_%') then
    raise exception 'FAIL: inactive staff retains member access';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000099', true);
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.members where admission_id like '__rls_test_%') then
    raise exception 'FAIL: user without a staff assignment can read members';
  end if;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    perform 1 from public.members limit 1;
    raise exception 'FAIL: anonymous member access';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
select 'PASS: role smoke checks completed; all test changes rolled back' as result;
