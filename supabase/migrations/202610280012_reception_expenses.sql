-- Run after 011 as postgres. Does not create or modify Auth accounts/passwords.
begin;
drop policy if exists expense_read on public.expenses;
create policy expense_read on public.expenses for select to authenticated
using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
drop policy if exists expense_insert on public.expenses;
create policy expense_insert on public.expenses for insert to authenticated
with check(zenith_private.staff_role(gym_id) in ('admin','receptionist') and status='recorded'
 and exists(select 1 from public.staff s where s.gym_id=expenses.gym_id and s.id=expenses.created_by and s.user_id=auth.uid() and s.is_active));
-- Existing expense_update remains admin-only. Reception cannot void/edit entries.
commit;
select 'Reception may view and add expenses; only admins may void/edit expenses' as result;
