-- Run after migration 009 as postgres. Existing member/payment data is unchanged.
begin;
create table public.whatsapp_templates (
 gym_id uuid not null references public.gyms(id),template_key text not null,
 title text not null,body text not null check(length(trim(body)) between 1 and 6000),
 variables text[] not null,updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid references auth.users(id),primary key(gym_id,template_key)
);
alter table public.whatsapp_templates enable row level security;
revoke all on public.whatsapp_templates from public,anon,authenticated;
grant select on public.whatsapp_templates to authenticated;
grant all on public.whatsapp_templates to service_role;
create policy message_read on public.whatsapp_templates for select to authenticated using(zenith_private.staff_role(gym_id) in ('admin','receptionist'));
insert into public.whatsapp_templates(gym_id,template_key,title,body,variables) values
('b80cd818-2abe-4a90-9027-e2ba1916aec4','admission','Admission confirmation','Welcome to Zenith Fitness {{member_name}} 💪

Your admission has been successfully completed.

🆔 Admission ID: {{admission_id}}
-> Plan: {{plan}}
-> Start Date: {{start_date}}
-> End Date: {{end_date}}

We’re excited to be a part of your fitness journey 🔥

-> Gym Timings:
Mon–Sat: 6:00 AM – 11:00 PM
Sunday: 6:30 AM – 10:00 AM (MORNING) || 5:00 PM – 9:00 PM (EVENING)

📲 Important:
Save this number *9272112745* in your contacts to receive important updates, workout tips, and announcements.

📸 Instagram:
https://www.instagram.com/zenithfitness360

Let’s build your best version together',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','amount_paid','pending_amount']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','renewal_reminder','Renewal reminder','Hello {{member_name}},

Your Zenith Fitness membership ends on {{end_date}}.
Admission ID: {{admission_id}}
Package: {{plan}}

Please contact reception to renew your membership.

Team Zenith Fitness',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','amount_paid','pending_amount']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','renewed','Renewed membership confirmation','Hello {{member_name}},

Your membership at Zenith Fitness has been successfully renewed.

Admission ID: {{admission_id}}

Plan: {{plan}}

Start Date: {{start_date}}

End Date: {{end_date}}

Thank you for continuing your fitness journey with us. 💪

We truly appreciate your trust and support.

⭐ If you are genuinely happy with our services, we would be grateful if you could leave us a Google Review.

Your review helps us grow, reach more people, and build a stronger and healthier fitness community.

Google Review Link:

https://g.page/r/CTR-7sBIfPWYEBM/review

Thank you for being a valued member of Zenith Fitness.

Stay Fit. Stay Strong. 🔥

Team Zenith Fitness',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','amount_paid','pending_amount']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','pt','Personal training confirmation','Hello {{member_name}},

Your personal training package is confirmed.
Admission ID: {{admission_id}}
Package: {{plan}}
Trainer: {{trainer_name}}
Start date: {{start_date}}
End date: {{end_date}}
Amount paid: {{amount_paid}}
Pending amount: {{pending_amount}}

Team Zenith Fitness',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','amount_paid','pending_amount','trainer_name']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','enquiry','Enquiry response','Thank You for enquiring at Zenith Fitness :)

We’re located behind ITI College, Hanuman Nagar, Pachgaon Road, Kolhapur.

Here is what we offer:

-> Strength Training
-> Cardio
-> Group Batches: Functional | Zumba | Yoga
-> FREE 45 Days BMI Checkup
-> FREE Diet Plan on 3 Months & Above Membership
-> FREE Steam Sessions Every Month

Gym Timings:
-> Mon–Sat: 6:00 AM – 11:00 PM (FULL DAY)
-> Sunday: 6:30 AM – 10:00 AM (MORNING)
           5:00 PM – 9:00 PM (EVENING)

-> FREE one-day trial available!

------------------------------
Zenith Fitness Membership Packages
------------------------------

Male Membership Charges:
-> 1 Month – Rs. 2000
-> 3 Months – Rs. 4699
-> 6 Months – Rs. 6499
-> 1 Year – Rs. 9991

Female Membership Charges:
-> 1 Month – Rs. 1499
-> 3 Months – Rs. 3999
-> 6 Months – Rs. 5699
-> 1 Year – Rs. 8999

Happy Hours (10 AM TO 4 PM [Only for Females]):
-> 1 Month – Rs. 1000
-> 3 Months – Rs. 3000
-> 6 Months – Rs. 4500
-> 1 Year – Rs. 6000

Memberships include access to Strength Training, Cardio Zone, Functional Training, Group Batches, and Premium Gym Equipment.

For enquiries or to start your fitness journey:
-> 9272112745

Instagram:
-> https://www.instagram.com/zenithfitness360',array['member_name','phone','gym_name','gym_phone','address','plan','follow_up_date']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','followup','Lead follow-up','Hello {{member_name}},

We''re eagerly waiting to welcome you to Zenith Fitness.

Every transformation begins with a single decision. We''re here to guide you every step of the way. Let''s begin your fitness journey together.

Zenith Fitness, Hanuman Nagar, Pachgaon Road, Kolhapur
9272112745

Best regards,
Team Zenith',array['member_name','phone','gym_name','gym_phone','address','plan','follow_up_date']),
('b80cd818-2abe-4a90-9027-e2ba1916aec4','pending','Pending payment reminder','Hello {{member_name}},

Your outstanding balance at Zenith Fitness is {{pending_amount}}.
Admission ID: {{admission_id}}
Package: {{plan}}

Please contact reception to complete your payment.

Team Zenith Fitness',array['member_name','admission_id','phone','gym_name','gym_phone','plan','start_date','end_date','amount_paid','pending_amount']);
create or replace function public.save_whatsapp_template(target_gym uuid,target_key text,new_body text,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.whatsapp_templates; saved public.whatsapp_templates; token text[];
begin
 if zenith_private.staff_role(target_gym) is distinct from 'admin' then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into old_row from public.whatsapp_templates where gym_id=target_gym and template_key=target_key for update;
 if not found then raise exception 'Message template not found'; end if;
 if expected_updated_at is distinct from old_row.updated_at then raise exception 'This message was changed by another admin. Reload the saved message before editing again.'; end if;
 if new_body is null or length(trim(new_body))=0 or length(new_body)>6000 then raise exception 'Enter a message between 1 and 6000 characters'; end if;
 for token in select regexp_matches(new_body,'\{\{([^{}]*)\}\}','g') loop
   if not token[1]=any(old_row.variables) then raise exception 'Unknown placeholder: %',token[1]; end if;
 end loop;
 if regexp_replace(new_body,'\{\{[a-z_]+\}\}','','g') like '%{{%' or regexp_replace(new_body,'\{\{[a-z_]+\}\}','','g') like '%}}%' then raise exception 'Use placeholders exactly as shown, such as {{member_name}}'; end if;
 update public.whatsapp_templates set body=new_body,updated_at=clock_timestamp(),updated_by=auth.uid() where gym_id=target_gym and template_key=target_key returning * into saved;
 insert into public.audit_logs(gym_id,actor_user_id,action,entity_type,details)
 values(target_gym,auth.uid(),'message.updated','whatsapp_template',jsonb_build_object('template_key',target_key,'before',old_row.body,'after',new_body));
 insert into public.sync_jobs(gym_id,destination,event_type,deduplication_key,payload)
 values(target_gym,'google_sheets','member.profile','message-template:'||target_key||':'||saved.updated_at::text,jsonb_build_object('template_key',target_key));
 return to_jsonb(saved);
end $$;
revoke all on function public.save_whatsapp_template(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.save_whatsapp_template(uuid,text,text,timestamptz) to authenticated;
create or replace function public.get_fallback_snapshot(target_gym uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if coalesce(zenith_private.staff_role(target_gym),'') not in ('admin','receptionist') then raise exception 'Staff access required' using errcode='42501'; end if;
 -- All projection inputs are selected in one statement/snapshot.
 select jsonb_build_object('gym_id',target_gym,'generated_at',statement_timestamp(),
  'last_admission_id',(select last_assigned_id from public.member_id_counters where gym_id=target_gym),
  'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.members m where m.gym_id=target_gym),'[]'),
  'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.memberships m where m.gym_id=target_gym),'[]'),
  'plans',coalesce((select jsonb_agg(to_jsonb(p)) from public.membership_plans p where p.gym_id=target_gym),'[]'),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)) from public.payments p where p.gym_id=target_gym),'[]'),
  'historicalReceipts',coalesce((select jsonb_agg(to_jsonb(r)) from public.historical_receipts r where r.gym_id=target_gym),'[]'),
  'ptContracts',coalesce((select jsonb_agg(to_jsonb(p)) from public.pt_contracts p where p.gym_id=target_gym),'[]'),
  'whatsapp_templates',coalesce((select jsonb_agg(to_jsonb(t)) from public.whatsapp_templates t where t.gym_id=target_gym),'[]'),
  'reserved_devices',coalesce((select jsonb_agg(to_jsonb(r)) from public.reserved_device_ids r where r.gym_id=target_gym),'[]'),
  'ptPayments',coalesce((select jsonb_agg(to_jsonb(p)) from public.pt_payments p where p.gym_id=target_gym),'[]')) into snapshot;
 return snapshot;
end $$;
revoke all on function public.get_fallback_snapshot(uuid) from public,anon;
grant execute on function public.get_fallback_snapshot(uuid) to authenticated;
commit;
select template_key,title from public.whatsapp_templates where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' order by template_key;
