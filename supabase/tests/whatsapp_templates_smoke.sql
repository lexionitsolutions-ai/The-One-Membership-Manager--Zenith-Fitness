-- Run after 010 as postgres. All test template edits and fixtures roll back.
begin;
insert into public.gyms(id,name) values('fa000000-0000-4000-8000-000000000092','Temporary WhatsApp test gym');
insert into public.staff(gym_id,user_id,full_name,role) values('fa000000-0000-4000-8000-000000000092','3cf3542d-3425-4b52-991a-858d4c4da6a1','Temporary admin','admin');
insert into public.whatsapp_templates(gym_id,template_key,title,body,variables)
select 'fa000000-0000-4000-8000-000000000092',template_key,title,body,variables from public.whatsapp_templates where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4';
select set_config('request.jwt.claim.sub','3cf3542d-3425-4b52-991a-858d4c4da6a1',true);
select set_config('request.jwt.claims','{"sub":"3cf3542d-3425-4b52-991a-858d4c4da6a1","role":"authenticated"}',true);
set local role authenticated;
do $$
declare gym uuid='fa000000-0000-4000-8000-000000000092'; version timestamptz; saved jsonb; blocked boolean=false;
begin
 if (select count(*) from public.whatsapp_templates where gym_id=gym and template_key in ('admission','renewal_reminder','renewed','pt','enquiry','followup','pending'))<>7 then raise exception 'FAIL: default templates missing'; end if;
 select updated_at into version from public.whatsapp_templates where gym_id=gym and template_key='admission';
 saved=public.save_whatsapp_template(gym,'admission','Welcome {{member_name}}! Your ID is {{admission_id}}.',version);
 if saved->>'body'<>'Welcome {{member_name}}! Your ID is {{admission_id}}.' then raise exception 'FAIL: saved message'; end if;
 begin perform public.save_whatsapp_template(gym,'admission','Stale overwrite',version); exception when raise_exception then blocked=true; end;
 if not blocked then raise exception 'FAIL: stale admin edit accepted'; end if;
 blocked=false;
 begin perform public.save_whatsapp_template(gym,'admission','Invalid {{unknown_field}}',(saved->>'updated_at')::timestamptz); exception when raise_exception then blocked=true; end;
 if not blocked then raise exception 'FAIL: unknown placeholder accepted'; end if;
 blocked=false;
 begin update public.whatsapp_templates set body='Direct update' where gym_id=gym; exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'FAIL: direct client update allowed'; end if;
 if not exists(select 1 from public.audit_logs where gym_id=gym and action='message.updated') then raise exception 'FAIL: edit audit missing'; end if;
 if not exists(select 1 from public.sync_jobs where gym_id=gym and payload->>'template_key'='admission') then raise exception 'FAIL: fallback message refresh not queued'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
do $$ declare blocked boolean=false; begin
 if exists(select 1 from public.whatsapp_templates) then raise exception 'FAIL: non-staff template visibility'; end if;
 begin perform public.save_whatsapp_template('fa000000-0000-4000-8000-000000000092','admission','Forbidden',now()); exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'FAIL: non-admin template editing'; end if;
end $$;
reset role;
rollback;
select 'PASS: shared WhatsApp messages, admin editing, placeholders, edit conflicts and access; all changes rolled back' as result;
