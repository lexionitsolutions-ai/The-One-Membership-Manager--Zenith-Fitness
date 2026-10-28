"""Build a repeat-safe repair from the canonical 003/004 migrations.
No remote database connection and no imported member data in the output.
"""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def build():
    management=(ROOT/'supabase/migrations/202610270003_management.sql').read_text(encoding='utf-8-sig')
    direct=(ROOT/'supabase/migrations/202610270004_direct_forms.sql').read_text(encoding='utf-8-sig')
    def unwrap(text):
        text=re.sub(r'^begin;\s*','',text,count=1,flags=re.MULTILINE)
        return re.sub(r'commit;\s*$','',text,count=1)
    management=unwrap(management)
    direct=unwrap(direct)
    management=management.replace('create function ','create or replace function ')
    direct=direct.replace('create function ','create or replace function ')
    direct=direct.replace('create table public.form_submissions','create table if not exists public.form_submissions')
    policy_pattern=r'create policy (\w+) on public\.(\w+) .*?;'
    policy_count=0
    def guard_policy(match):
        nonlocal policy_count
        policy_count+=1
        name,table=match.group(1),match.group(2)
        return f"do $repair_policy$ begin\n  if not exists(select 1 from pg_policies where schemaname='public' and tablename='{table}' and policyname='{name}') then\n    {match.group(0)}\n  end if;\nend $repair_policy$;"
    management=re.sub(policy_pattern,guard_policy,management)
    if policy_count!=5:raise RuntimeError('Unexpected policy structure; inspect the management migration')
    trigger="create trigger protect_last_admin before update or delete on public.staff\nfor each row execute function zenith_private.protect_last_admin();"
    if trigger not in management:raise RuntimeError('Last-admin trigger not found')
    management=management.replace(trigger,"do $repair_trigger$ begin\n  if not exists(select 1 from pg_trigger where tgrelid='public.staff'::regclass and tgname='protect_last_admin' and not tgisinternal) then\n    "+trigger+"\n  end if;\nend $repair_trigger$;")
    old="    execute format('create trigger audit_management after insert or update or delete on public.%I for each row execute function zenith_private.audit_management()',t);"
    if old not in management:raise RuntimeError('Audit trigger loop not found')
    management=management.replace(old,"    if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||t) and tgname='audit_management' and not tgisinternal) then\n"+old+"\n    end if;")
    prefix="""-- Repair incomplete management/direct-form setup. Run as postgres in SQL Editor.
-- Safe to run again: keeps existing member, membership, payment and staff rows.
-- Recreates application functions and adds missing tables/columns/policies/triggers.
-- Does not import data or send anything to Sheets/the fingerprint device.
-- Clear any transaction left aborted by the failed rollback-only smoke test.
rollback;
begin;
do $prerequisites$ begin
  if to_regclass('public.members') is null or to_regclass('public.staff') is null
    or to_regclass('public.memberships') is null
    or to_regprocedure('zenith_private.staff_role(uuid)') is null then
    raise exception 'Initial setup is missing. Run migrations 001 and 002 before this repair.';
  end if;
end $prerequisites$;
"""
    suffix="""
commit;
select
  to_regprocedure('public.save_membership(uuid,jsonb)') is not null as save_membership_ready,
  to_regprocedure('public.record_payment(uuid,jsonb)') is not null as record_payment_ready,
  to_regprocedure('public.import_gym_snapshot(uuid,jsonb)') is not null as import_ready,
  to_regprocedure('public.submit_gym_form(uuid,uuid,jsonb)') is not null as direct_forms_ready;
"""
    output=prefix+management+'\n'+direct+suffix
    target=ROOT/'supabase/setup/repair_management_and_direct_forms.sql'
    target.write_text(output,encoding='utf-8')
    print(f'Created {target.relative_to(ROOT)} ({len(output)} characters)')

if __name__=='__main__':build()
