-- Approved message wording supplied on 2026-10-28. No messages are sent.
-- Applies only the four requested message types. Other custom templates remain intact.
begin;
update public.whatsapp_templates set body='Welcome to Zenith Fitness {{member_name}} 💪

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

Let’s build your best version together',updated_at=clock_timestamp() where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' and template_key='admission';
update public.whatsapp_templates set body='Hello {{member_name}},

This is a gentle reminder that your membership at Zenith Fitness will expire on {{end_date}}.

We look forward to continuing your fitness journey with us 💪

You may renew conveniently via UPI / GPay on 📱 9272112745.

Stay consistent. Stay strong. 🔥',updated_at=clock_timestamp() where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' and template_key='renewal_reminder';
update public.whatsapp_templates set body='Hello {{member_name}},

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

Team Zenith Fitness',updated_at=clock_timestamp() where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' and template_key='renewed';
update public.whatsapp_templates set body='Thank You for enquiring at Zenith Fitness :)

We’re located behind ITI College, Hanuman Nagar, Pachgaon Road, Kolhapur.

Here is what we offer:

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
-> https://www.instagram.com/zenithfitness360',updated_at=clock_timestamp() where gym_id='b80cd818-2abe-4a90-9027-e2ba1916aec4' and template_key='enquiry';
commit;
