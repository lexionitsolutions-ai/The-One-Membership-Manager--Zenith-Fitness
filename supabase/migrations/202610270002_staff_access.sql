-- Run once, after 202610270001_initial_schema.sql and first admin setup.
-- Roles come from the staff table, never from user-editable Auth metadata.
begin;

create schema if not exists zenith_private;
revoke all on schema zenith_private from public, anon, authenticated;
grant usage on schema zenith_private to authenticated;

-- Definer functions avoid recursive staff/assignment RLS queries.
-- Keep this schema outside the Supabase Data API's exposed schemas.
create function zenith_private.staff_role(target_gym uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select s.role from public.staff s
  where s.gym_id = target_gym and s.user_id = (select auth.uid())
    and s.is_active;
$$;

create function zenith_private.assigned_member(target_gym uuid, target_member uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trainer_assignments a
    join public.staff s on s.gym_id = a.gym_id and s.id = a.trainer_id
    where a.gym_id = target_gym and a.member_id = target_member
      and s.user_id = (select auth.uid()) and s.is_active and s.role = 'trainer'
  );
$$;

revoke all on function zenith_private.staff_role(uuid) from public, anon;
revoke all on function zenith_private.assigned_member(uuid, uuid) from public, anon;
grant execute on function zenith_private.staff_role(uuid) to authenticated;
grant execute on function zenith_private.assigned_member(uuid, uuid) to authenticated;

grant select on public.gyms, public.staff, public.members,
  public.member_private_details, public.membership_plans, public.memberships,
  public.payments, public.trainer_assignments, public.attendance,
  public.enquiries, public.sync_jobs, public.audit_logs to authenticated;
grant update on public.gyms to authenticated;
grant insert, update on public.members, public.member_private_details,
  public.membership_plans, public.memberships, public.enquiries to authenticated;
grant insert, update, delete on public.staff, public.trainer_assignments to authenticated;
grant insert on public.payments to authenticated;

create policy gym_read on public.gyms for select to authenticated
using (zenith_private.staff_role(id) is not null);
create policy gym_update on public.gyms for update to authenticated
using (zenith_private.staff_role(id) = 'admin')
with check (zenith_private.staff_role(id) = 'admin');

create policy staff_read on public.staff for select to authenticated
using (zenith_private.staff_role(gym_id) = 'admin'
  or (user_id = (select auth.uid()) and is_active));
create policy staff_insert on public.staff for insert to authenticated
with check (zenith_private.staff_role(gym_id) = 'admin');
create policy staff_update on public.staff for update to authenticated
using (zenith_private.staff_role(gym_id) = 'admin')
with check (zenith_private.staff_role(gym_id) = 'admin');
create policy staff_delete on public.staff for delete to authenticated
using (zenith_private.staff_role(gym_id) = 'admin');

-- Admin/receptionist read operational records. Trainers get separate, narrower rules.
do $$
declare t text;
begin
  foreach t in array array[
    'members', 'member_private_details', 'memberships', 'payments', 'enquiries'
  ] loop
    execute format(
      'create policy operational_read on public.%I for select to authenticated
       using (zenith_private.staff_role(gym_id) in (''admin'', ''receptionist''))', t);
  end loop;
  foreach t in array array['members', 'member_private_details', 'memberships', 'enquiries'] loop
    execute format(
      'create policy operational_insert on public.%I for insert to authenticated
       with check (zenith_private.staff_role(gym_id) in (''admin'', ''receptionist''))', t);
  end loop;
  foreach t in array array['members', 'member_private_details', 'enquiries'] loop
    execute format(
      'create policy operational_update on public.%I for update to authenticated
       using (zenith_private.staff_role(gym_id) in (''admin'', ''receptionist''))
       with check (zenith_private.staff_role(gym_id) in (''admin'', ''receptionist''))', t);
  end loop;
end $$;

create policy membership_admin_update on public.memberships for update to authenticated
using (zenith_private.staff_role(gym_id) = 'admin')
with check (zenith_private.staff_role(gym_id) = 'admin');

-- Payment history is append-only for all browser users.
-- Receptionists may record payments as themselves; refunds require an admin.
create policy payment_insert on public.payments for insert to authenticated
with check (
  zenith_private.staff_role(gym_id) in ('admin', 'receptionist')
  and (kind = 'payment' or zenith_private.staff_role(gym_id) = 'admin')
  and exists (
    select 1 from public.staff s where s.id = recorded_by
      and s.gym_id = payments.gym_id and s.user_id = (select auth.uid())
      and s.is_active
  )
);

create policy plan_read on public.membership_plans for select to authenticated
using (zenith_private.staff_role(gym_id) is not null);
create policy plan_insert on public.membership_plans for insert to authenticated
with check (zenith_private.staff_role(gym_id) = 'admin');
create policy plan_update on public.membership_plans for update to authenticated
using (zenith_private.staff_role(gym_id) = 'admin')
with check (zenith_private.staff_role(gym_id) = 'admin');

create policy assigned_member_read on public.members for select to authenticated
using (zenith_private.assigned_member(gym_id, id));

create policy assignment_read on public.trainer_assignments for select to authenticated
using (zenith_private.staff_role(gym_id) in ('admin', 'receptionist')
  or exists (select 1 from public.staff s where s.id = trainer_id
    and s.gym_id = trainer_assignments.gym_id
    and s.user_id = (select auth.uid()) and s.is_active and s.role = 'trainer'));
create policy assignment_insert on public.trainer_assignments for insert to authenticated
with check (zenith_private.staff_role(gym_id) = 'admin'
  and exists (select 1 from public.staff s where s.id = trainer_id
    and s.gym_id = trainer_assignments.gym_id and s.role = 'trainer' and s.is_active));
create policy assignment_update on public.trainer_assignments for update to authenticated
using (zenith_private.staff_role(gym_id) = 'admin')
with check (zenith_private.staff_role(gym_id) = 'admin'
  and exists (select 1 from public.staff s where s.id = trainer_id
    and s.gym_id = trainer_assignments.gym_id and s.role = 'trainer' and s.is_active));
create policy assignment_delete on public.trainer_assignments for delete to authenticated
using (zenith_private.staff_role(gym_id) = 'admin');

create policy attendance_read on public.attendance for select to authenticated
using (zenith_private.staff_role(gym_id) in ('admin', 'receptionist')
  or zenith_private.assigned_member(gym_id, member_id));

create policy sync_admin_read on public.sync_jobs for select to authenticated
using (zenith_private.staff_role(gym_id) = 'admin');
create policy audit_admin_read on public.audit_logs for select to authenticated
using (zenith_private.staff_role(gym_id) = 'admin');

-- No browser writes to attendance, sync jobs, or audit logs.
-- No anonymous table access. Medical details and finances remain hidden from trainers.
commit;

select 'Staff access policies installed' as result, count(*) as policy_count
from pg_policies where schemaname = 'public' and tablename in (
  'gyms', 'staff', 'members', 'member_private_details', 'membership_plans',
  'memberships', 'payments', 'trainer_assignments', 'attendance', 'enquiries',
  'sync_jobs', 'audit_logs'
);
