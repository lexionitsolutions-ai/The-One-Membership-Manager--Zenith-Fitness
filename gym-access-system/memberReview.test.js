const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {buildDashboard}=require('./dashboardMetrics');const {buildMemberReviews,isPersonalTraining}=require('./memberReviewData');const {createDashboardRouter}=require('./dashboardRoutes');const {ZENITH_GYM_ID}=require('./reservedDeviceIds');
test('PT-prefixed periods move to PT without duplicating payments or changing member/device identity',()=>{
 const data={members:[{id:'pt',admission_id:'PT-10',device_user_id:10,full_name:'PT Member',phone:'9876543210'}],memberships:[{id:'legacy',member_id:'pt',plan_id:'p',kind:'admission',start_date:'2026-09-01',end_date:'2026-09-30',status:'confirmed',final_amount:100,opening_paid_amount:0,accounting_verified:true}],plans:[{id:'p',name:'PT month'}],payments:[{membership_id:'legacy',amount:50,kind:'payment',paid_at:'2026-10-01'},{membership_id:'legacy',amount:10,kind:'refund',paid_at:'2026-10-02'}],ptContracts:[{id:'contract',member_id:'pt',trainer_id:'t',total_amount:50}],ptPayments:[{contract_id:'contract',amount:20,paid_at:'2026-10-03'}]};
 const before=JSON.stringify(data);const d=buildDashboard(data,{role:'admin',now:new Date('2026-10-28T12:00:00Z'),from:'2026-10-01',to:'2026-10-28'});
 assert.equal(d.memberships.length,0);assert.equal(d.personalTraining.length,2);assert.equal(d.personalTraining.find(p=>p.legacy_membership).paid_amount,40);assert.equal(d.personalTraining.find(p=>p.legacy_membership).outstanding,60);
 assert.equal(d.metrics.revenue,60);assert.equal(d.metrics.pending,90);assert.equal(d.metrics.ptPending,90);assert.equal(d.renewalSchedule.length,0);assert.equal(d.reviewMembers.length,0);assert.equal(d.legacyPTBalances[0].id,'legacy');assert.equal(JSON.stringify(data),before);
 assert.equal(isPersonalTraining({admission_id:' pt123 '}),true);assert.equal(isPersonalTraining({admission_id:'ZF-1',category:'Personal Training'}),false);
});
test('review list excludes PT, archived, team, active and already-renewed members',()=>{
 const members=['expired','renewed','active','pt','archived','team'].map((id,i)=>({id,full_name:id,admission_id:id==='pt'?'PT-1':id==='team'?'ZF-2985':'ZF-'+(i+1),device_user_id:id==='team'?2985:i+1,is_archived:id==='archived'}));
 const memberships=members.map(m=>({id:'p-'+m.id,member_id:m.id,status:'confirmed',start_date:'2026-09-01',end_date:m.id==='active'?'2026-11-01':'2026-09-30'}));
 memberships.push({id:'new',member_id:'renewed',status:'confirmed',start_date:'2026-11-01',end_date:'2026-11-30'});
 const rows=buildMemberReviews({gymId:ZENITH_GYM_ID,members,memberships},'2026-10-28');assert.deepEqual(rows.map(r=>r.member_id),['expired']);assert.equal(rows[0].expiry_month,'2026-09');
});
test('renewal closes the old review cycle while a later expiry creates a fresh follow-up',()=>{
 const data={members:[{id:'m',full_name:'Member',admission_id:'ZF-1'}],memberships:[{id:'old',member_id:'m',status:'confirmed',end_date:'2026-09-30'},{id:'new',member_id:'m',status:'confirmed',end_date:'2026-11-01'}],memberReviews:[{id:'review',membership_id:'old',member_id:'m',status:'Interested',reason:'Busy schedule',return_date:'2026-10-01'}]};
 let rows=buildMemberReviews(data,'2026-10-28');assert.equal(rows.length,1);assert.equal(rows[0].returned,true);assert.equal(rows[0].review_status,'Came Back & Renewed');
 rows=buildMemberReviews(data,'2026-11-02');assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id==='new').review_status,'Pending');assert.equal(rows.find(r=>r.id==='old').reason,'Busy schedule');
});
test('member follow-up API permits admin/reception, rejects trainer, and uses session gym',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';let role='admin';const calls=[];
 const mock=async(url,opts)=>{const u=new URL(url);calls.push({u,opts});if(u.pathname==='/auth/v1/token')return Response.json({access_token:'jwt',refresh_token:'r',expires_in:3600,user:{id:'u'}});if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff',gym_id:'real-gym',role,user_id:'u',is_active:true}]);if(u.pathname==='/rest/v1/rpc/save_member_review')return Response.json({success:true});if(u.pathname==='/rest/v1/member_review_history')return Response.json([]);throw new Error('Unexpected request');};
 const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/portal`;
 try{assert.equal((await fetch(base+'/member-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'a',password:'b'})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const body={requestId:'fa000000-0000-4000-8000-000000000099',membership_id:'fa000000-0000-4000-8000-000000000011',status:'Interested',return_date:'2026-11-01',contact_type:'Call',target_gym:'forged'};
 for(role of ['admin','receptionist']){assert.equal((await fetch(base+'/member-reviews',{method:'POST',headers,body:JSON.stringify(body)})).status,200);assert.equal(JSON.parse(calls.at(-1).opts.body).target_gym,'real-gym');assert.equal((await fetch(base+'/member-reviews/'+body.membership_id+'/history',{headers})).status,200);}
 role='trainer';assert.equal((await fetch(base+'/member-reviews',{method:'POST',headers,body:JSON.stringify(body)})).status,403);assert.equal((await fetch(base+'/member-reviews/'+body.membership_id+'/history',{headers})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
