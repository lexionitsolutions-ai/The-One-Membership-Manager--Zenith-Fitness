const {test}=require('node:test');const assert=require('node:assert/strict');
const {buildDashboard}=require('./dashboardMetrics');
test('admin activity joins both histories to their authors and people, filters India dates and excludes admin edits',()=>{
 const data={staff:[{id:'r',user_id:'ru',role:'receptionist',full_name:'Zenith Reception',is_active:false},{id:'a',user_id:'au',role:'admin'}],
  members:[{id:'m',full_name:'Member Name',admission_id:'ZF-661',phone:'9000000000'}],
  memberships:[{id:'p',member_id:'m',status:'confirmed',kind:'admission',start_date:'2026-09-01',end_date:'2026-09-30'}],
  enquiries:[{id:'e',full_name:'Enquiry Name',phone:'8000000000'}],
  enquiryFollowups:[{id:'lead1',enquiry_id:'e',actor_user_id:'ru',from_status:'Pending',to_status:'Call Done',remark:'Called back',created_at:'2026-10-27T18:30:00Z'},
   {id:'lead2',enquiry_id:'e',actor_user_id:'au',to_status:'Call Done',created_at:'2026-10-28T01:00:00Z'},
   {id:'old',enquiry_id:'e',actor_user_id:'ru',created_at:'2026-10-27T18:29:59Z'}],
  memberReviewHistory:[{id:'review1',membership_id:'p',recorded_by:'r',status:'Interested',reason:'Busy schedule',return_date:'2026-11-02',next_follow_up_date:'2026-11-01',remark:'Evening call',created_at:'2026-10-28T02:00:00Z'}]};
 const options={role:'admin',from:'2026-10-28',to:'2026-10-28',now:new Date('2026-10-28T12:00:00Z')};
 const events=buildDashboard(data,options).receptionActivity;
 assert.deepEqual(events.map(e=>e.id),['review1','lead1']);assert.equal(events[0].person_name,'Member Name');assert.equal(events[0].admission_id,'ZF-661');assert.equal(events[0].return_date,'2026-11-02');
 assert.equal(events[0].staff_name,'Zenith Reception');assert.equal(events[1].person_name,'Enquiry Name');assert.equal(events[1].previous_status,'Pending');assert.equal(events[1].remark,'Called back');
 for(const role of ['receptionist','trainer'])assert.equal(buildDashboard(data,{...options,role}).receptionActivity,undefined);
});
