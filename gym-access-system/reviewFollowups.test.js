const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const express=require('express');
const {buildMemberReviews}=require('./memberReviewData');
const {createDashboardRouter}=require('./dashboardRoutes');

function browser(data){
 const state={page:'review',data,search:'',filters:{}};
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context=vm.createContext({state,Date,Intl,URL,document:{addEventListener(){}},escapeHtml,
  filtersForPage:()=>state.filters[state.page]||=( {} ),
  matched:row=>JSON.stringify(row).toLowerCase().includes(state.search.toLowerCase()),
  fmt:String,simpleDate:value=>value||'Not recorded',time:()=> '10:00 am',
  badge:value=>`<span class="badge">${escapeHtml(value)}</span>`,
  empty:title=>title,resultsFooter:()=>'',addButton:()=>'',field:(name,label,options)=>`<label>${label}${options.options?`<select name="${name}">${options.options.map(o=>`<option>${typeof o==='string'?o:o.name}</option>`).join('')}</select>`:`<input name="${name}" type="${options.type||'text'}" value="${options.value||''}">`}</label>`,
  ZenithMessages:{render:()=> 'Message',url:phone=>phone?'https://wa.me/'+phone:null}
 });
 for(const file of ['leads.js','review-members.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard',file),'utf8'),context);
 return {state,run:code=>vm.runInContext(code,context)};
}
const review=(id,changes={})=>({id,member_id:id,member_name:id,admission_id:'ZF-'+id,phone:'9876543210',end_date:'2026-10-01',expiry_month:'2026-10',review_status:'Called',returned:false,history:[],...changes});

test('Review Members exposes only three primary parameters and keeps other filters inside Parameters',()=>{
 const page=browser({today:'2026-11-04',reviewMembers:[]});
 const html=page.run('renderReviewMembers(state.data)'),primary=html.split('<details')[0],parameters=html.split('<details')[1].split('</details>')[0];
 assert.equal((primary.match(/<label /g)||[]).length,3);
 assert.ok(primary.indexOf('Expiry month')<primary.indexOf('Match date'));
 assert.ok(primary.indexOf('Match date')<primary.indexOf('Select date'));
 assert.ok(!primary.includes('Search'));assert.ok(parameters.includes('<summary>Parameters</summary>'));
 for(const label of ['Search','Follow-ups','Reason','Clear date'])assert.ok(parameters.includes(label));
 assert.ok(!html.includes('class="review-parameters" open'));
});
test('Not Interested stays visible in red, rejoin dates are green, and explicit status wins conflicts',()=>{
 const page=browser({today:'2026-11-04',reviewMembers:[review('red',{review_status:'Not Interested'}),review('green',{return_date:'2026-11-30'})]});
 assert.equal(page.run('reviewRows().length'),2);
 assert.equal(page.run('reviewCardClass(state.data.reviewMembers[0])'),'review-not-interested');
 assert.equal(page.run('reviewCardClass(state.data.reviewMembers[1])'),'review-rejoining');
 assert.equal(page.run("reviewCardClass({review_status:'Not Interested',return_date:'2026-11-30'})"),'review-not-interested');
 page.run("filtersForPage().reviewBucket='Not Interested'");assert.equal(page.run('reviewRows().length'),1);
});
test('review form offers CNR with one shared date and no contact-type or separate rejoin input',()=>{
 const page=browser({today:'2026-11-04',reviewMembers:[review('single',{return_date:'2026-11-04'})]});
 const html=page.run('reviewEntryFields(state.data.reviewMembers[0])');
 assert.ok(html.includes('Call Not Received (CNR)'));
 assert.equal((html.match(/type="date"/g)||[]).length,1);
 assert.ok(html.includes('Next follow-up / Rejoin date'));assert.ok(html.includes('value="2026-11-04"'));
 assert.ok(!html.includes('name="contact_type"'));assert.ok(!html.includes('name="return_date"'));
 for(const status of ['Interested','Call Later','Call Not Received (CNR)','WhatsApp Sent','Pending']){
  const payload=JSON.parse(page.run(`JSON.stringify(reviewEntryPayload({status:${JSON.stringify(status)},next_follow_up_date:'2026-11-04'}))`));
  assert.equal(payload.next_follow_up_date,'2026-11-04');assert.equal(payload.return_date,payload.next_follow_up_date);
  assert.equal(payload.contact_type,status==='WhatsApp Sent'?'WhatsApp':status==='Pending'?'Other':'Call');
 }
 assert.equal(page.run("reviewEntryPayload({status:'Call Not Received (CNR)',next_follow_up_date:''}).return_date"),'');
 const card=page.run('reviewMemberCard(state.data.reviewMembers[0],state.data)');
 assert.equal((card.match(/Next follow-up \/ Rejoin date/g)||[]).length,1);
 assert.ok(!card.includes('<dt>Interested to rejoin</dt>'));
});
test('legacy rejoin dates schedule Old Gym Member calls and CNR is an unanswered attempt',()=>{
 const row=review('legacy',{return_date:'2026-11-04',history:[{status:'Call Not Received (CNR)',contact_type:'Call',created_at:'2026-11-04T04:30:00Z'}]});
 const page=browser({today:'2026-11-04',generatedAt:'2026-11-04T05:30:00Z',reviewMembers:[row],enquiries:[]});page.state.page='leads';
 const html=page.run('renderLeadManager(state.data)');
 assert.ok(html.includes('<h3 class="review-source-label">Old Gym Member</h3>'));
 assert.ok(html.includes('0 recorded contacts'));assert.ok(html.includes('1 unanswered call'));
 assert.equal(page.run('leadManagerRows(state.data).length'),1);
 page.run("filtersForPage().leadDate='2026-11-05'");assert.equal(page.run('leadManagerRows(state.data).length'),0);
});
test('member follow-ups join enquiry calls on the correct date across expiry months without copying enquiries',()=>{
 const data={today:'2026-11-04',enquiries:[{id:'enquiry',full_name:'New enquiry',lead_status:'Pending',next_follow_up_date:'2026-11-04'}],reviewMembers:[
  review('today',{expiry_month:'2026-08',next_follow_up_date:'2026-11-04'}),
  review('tomorrow',{next_follow_up_date:'2026-11-05',return_date:'2026-12-01'}),
  review('overdue',{next_follow_up_date:'2026-11-03'}),
  review('renewed',{next_follow_up_date:'2026-11-04',returned:true}),review('unscheduled'),
  review('declined',{review_status:'Not Interested',next_follow_up_date:'2026-11-04'})]};
 const page=browser(data);page.state.page='leads';
 assert.equal(page.run('leadManagerRows(state.data).length'),3);
 assert.equal(data.enquiries.length,1);
 const html=page.run('renderLeadManager(state.data)');assert.ok(html.includes('data-review-edit="today"'));assert.ok(html.includes('Old Gym Member'));assert.ok(html.includes('review-not-interested'));assert.ok(!html.includes('data-edit-enquiry="review:'));
 page.run("filtersForPage().leadBucket='Tomorrow'");assert.equal(page.run('leadManagerRows(state.data)[0].reviewMembershipId'),'tomorrow');
 page.run("filtersForPage().leadBucket='Overdue'");assert.equal(page.run('leadManagerRows(state.data)[0].reviewMembershipId'),'overdue');
 page.run("filtersForPage().leadDate='2026-11-05'");assert.equal(page.run('leadManagerRows(state.data).length'),1);
 page.state.search='ZF-tomorrow';assert.equal(page.run('leadManagerRows(state.data).length'),1);
 page.run("state.data.reviewMembers[1].returned=true");assert.equal(page.run('leadManagerRows(state.data).length'),0);
});
test('timeline counts saved contacts separately from updates, shows intervals, and escapes status text',()=>{
 const row=review('history',{history:[
  {status:'Pending',contact_type:'Other',created_at:'2026-11-01T04:30:00Z'},
  {status:'Called',contact_type:'Call',created_at:'2026-11-02T04:30:00Z'},
  {status:'WhatsApp Sent',contact_type:'WhatsApp',created_at:'2026-11-03T04:30:00Z'},
  {status:'<img src=x>',contact_type:'Other',created_at:'2026-11-03T05:30:00Z'},
  {status:'Interested',contact_type:'Call',created_at:'2026-11-04T04:30:00Z'}]});
 const page=browser({today:'2026-11-04',generatedAt:'2026-11-04T05:30:00Z',reviewMembers:[row]});
 const html=page.run('reviewTimeline(state.data.reviewMembers[0])');
 assert.ok(html.includes('5 status updates'));assert.ok(html.includes('3 recorded contacts'));
 assert.ok(html.includes('1 day after previous update'));assert.ok(html.includes('Last update 1 hr ago'));
 assert.equal((html.match(/<li>/g)||[]).length,4);assert.ok(html.includes('View all 5 updates'));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
 assert.ok(page.run("reviewTimeline({history_available:false})").includes('unavailable'));
});
test('review payload groups and orders complete history per membership and omits RPC/private fields',()=>{
 const data={members:[{id:'m',full_name:'Member',admission_id:'ZF-1'}],memberships:[{id:'period',member_id:'m',status:'confirmed',end_date:'2026-10-01'}],memberReviewHistory:[
  {id:'second',membership_id:'period',status:'Called',contact_type:'Call',created_at:'2026-11-02T04:30:00Z',payload_hash:'secret',result:{private:true}},
  {id:'first',membership_id:'period',status:'Pending',contact_type:'Other',created_at:'2026-11-01T04:30:00Z'},
  {id:'different',membership_id:'other',status:'Called',contact_type:'Call',created_at:'2026-10-01T04:30:00Z'}]};
 const [row]=buildMemberReviews(data,'2026-11-04');assert.deepEqual(row.history.map(h=>h.id),['first','second']);assert.ok(!JSON.stringify(row).includes('secret'));assert.ok(!JSON.stringify(row).includes('private'));
});
test('dashboard supplies full contact history to admin and reception across report dates, but never trainers',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
 let role='receptionist';const queries=[];
 const mock=async(url)=>{const u=new URL(url);
  if(u.pathname==='/auth/v1/token')return Response.json({access_token:'jwt',refresh_token:'r',expires_in:3600,user:{id:'u'}});
  if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff',gym_id:'real-gym',role,user_id:'u',is_active:true}]);
  if(u.pathname==='/rest/v1/members')return Response.json([{id:'m',full_name:'Member',admission_id:'ZF-1'}]);
  if(u.pathname==='/rest/v1/memberships')return Response.json([{id:'period',member_id:'m',status:'confirmed',kind:'admission',start_date:'2019-12-01',end_date:'2020-01-01',final_amount:100,accounting_verified:true}]);
  if(u.pathname==='/rest/v1/member_review_history'){
   queries.push(u);return Response.json([{id:'old-contact',membership_id:'period',status:'Called',contact_type:'Call',created_at:'2020-01-02T04:30:00Z'}]);
  }
  return Response.json([]);
 };
 const app=express();app.use(express.json());app.use(createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'a',password:'b'})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  for(role of ['admin','receptionist']){
   const response=await fetch(base+'/dashboard',{headers});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
   assert.equal(data.reviewMembers[0].history[0].id,'old-contact');
   const query=queries.at(-1);assert.equal(query.searchParams.get('gym_id'),'eq.real-gym');assert.equal(query.searchParams.has('created_at'),false);
  }
  role='trainer';const before=queries.length;const data=await(await fetch(base+'/dashboard',{headers})).json();assert.equal(data.reviewMembers,undefined);assert.equal(queries.length,before);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
