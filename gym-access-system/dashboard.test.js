const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { buildDashboard, dateKey } = require('./dashboardMetrics');
const { demoDashboard } = require('./dashboardDemo');
const { createDashboardRouter } = require('./dashboardRoutes');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {reportRange,packageGroup}=require('./reporting');

test('PT calendar dates clamp month ends and uncertain saves retain the same request ID',async()=>{
  const storage=new Map(),calls=[];let fail=true;
  const context=vm.createContext({window:{},document:{addEventListener(){}},Date,JSON,Error,crypto:{randomUUID:()=> 'request-one'},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(path,options)=>{calls.push(JSON.parse(options.body));if(fail){fail=false;throw new Error('Connection lost');}return Response.json({success:true});}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../member-forms.js'),'utf8'),context);
  vm.runInContext('zenithRequest=window.zenithRequest;zenithCommand=window.zenithCommand;',context);
  assert.equal(vm.runInContext('window.zenithMonthEnd("2027-01-31",1)',context),'2027-02-28');
  assert.equal(vm.runInContext('window.zenithMonthEnd("2028-01-31",1)',context),'2028-02-29');
  await assert.rejects(vm.runInContext('zenithCommand("pt",{amount:100})',context),/Connection lost/);
  await assert.rejects(vm.runInContext('zenithCommand("pt",{amount:101})',context),/uncertain result/);
  await vm.runInContext('zenithCommand("pt",{amount:100})',context);
  assert.equal(calls.length,2);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(storage.size,0);
});

test('PT receipts and dues enter totals without inflating gym admissions or active members',()=>{
  const result=buildDashboard({members:[{id:'m',full_name:'Member',admission_id:'ZF-1',created_at:'2026-10-01'}],memberships:[],
    ptContracts:[{id:'pt',member_id:'m',trainer_id:'t',package:'2',total_amount:500,start_date:'2026-10-27',end_date:'2026-12-27'}],
    ptTrainers:[{id:'t',name:'Lakhan'}],ptPayments:[{id:'p',contract_id:'pt',amount:200,payment_mode:'UPI',paid_at:'2026-10-27T06:00:00Z'}]},
    {role:'admin',now:new Date('2026-10-27T12:00:00Z'),from:'2026-10-27',to:'2026-10-27'});
  assert.equal(result.metrics.revenue,200);assert.equal(result.metrics.pending,300);
  assert.equal(result.metrics.activeMembers,0);assert.equal(result.gymOverview.dailyAdmissions,0);
  assert.equal(result.gymOverview.dailyRenewals,0);assert.equal(result.gymOverview.onlineCollected,200);
  assert.equal(result.personalTraining[0].trainer_name,'Lakhan');assert.equal(result.personalTraining[0].outstanding,300);
  assert.equal(result.payments[0].member_name,'Member');assert.equal(result.monthlySales[0].collections,200);
});

test('form refresh preserves all existing controls and removes Sheets writes from Member Update',()=>{
  const root=path.join(__dirname,'..');
  for(const file of ['index.html','renewal.html','enquire.html','update.html']){
    const old=fs.readFileSync(path.join(root,'backups/before-form-refresh-20261027',file),'utf8');
    const current=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,id] of old.matchAll(/\bid="([^"]+)"/g))assert.ok(current.includes(`id="${id}"`),`${file} retains ${id}`);
    assert.match(current,/forms-modern.css/);assert.match(current,/forms-ui.js/);
  }
  const update=fs.readFileSync(path.join(root,'update.js'),'utf8');
  assert.doesNotMatch(update,/script.google|sync-access|admin\/sync-members/);
  for(const action of ['profile','membership','payment'])assert.ok(update.includes(`'${action}'`));
});

test('member commands use the authenticated gym and reject trainer access',async()=>{
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';let role='receptionist';const calls=[];
  const mock=async(url,opts)=>{const u=new URL(url);calls.push({u,opts});
    if(u.pathname==='/auth/v1/token')return Response.json({access_token:'staff-token',refresh_token:'refresh',expires_in:3600,user:{id:'u'}});
    if(u.pathname==='/rest/v1/staff')return Response.json([{id:'s',user_id:'u',gym_id:'real-gym',role,is_active:true}]);
    if(u.pathname==='/rest/v1/rpc/manage_member_form')return Response.json({success:true});
    if(u.pathname==='/rest/v1/pt_trainers')return Response.json([{id:'trainer',name:'Arif'}]);
    throw new Error('Unexpected request');};
  const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/portal`;
  try{assert.equal((await fetch(base+'/member-command',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'e',password:'p'})});const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};
    const requestId='fa000000-0000-4000-8000-000000000099';
    for(const command of ['profile','membership','payment','pt','pt_payment']){
      assert.equal((await fetch(base+'/member-command',{method:'POST',headers,body:JSON.stringify({command,payload:{member_id:'m'},requestId,target_gym:'forged-gym'})})).status,200);
      const sent=JSON.parse(calls.at(-1).opts.body);assert.equal(sent.target_gym,'real-gym');assert.equal(sent.request_uuid,requestId);assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer staff-token');
    }
    assert.equal((await fetch(base+'/pt-trainers',{headers})).status,200);
    role='trainer';for(const endpoint of ['member-details?mobile=9000000000','pt-trainers'])assert.equal((await fetch(base+'/'+endpoint,{headers})).status,403);
    assert.equal((await fetch(base+'/member-command',{method:'POST',headers,body:JSON.stringify({command:'pt',requestId,payload:{}})})).status,403);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('India day boundary, active renewal deduplication, refunds, and daily visits', () => {
  const now = new Date('2026-10-27T01:00:00Z');
  assert.equal(dateKey('2026-10-26T19:00:00Z'), '2026-10-27');
  const result = buildDashboard({
    members: [{ id:'m1',full_name:'Example',created_at:'2026-10-25',is_archived:false },{id:'m2',is_archived:true}],
    memberships: [
      { id:'s1',member_id:'m1',status:'confirmed',start_date:'2026-10-01',end_date:'2026-10-28',final_amount:100 },
      { id:'s2',member_id:'m1',status:'confirmed',start_date:'2026-10-29',end_date:'2026-11-28',final_amount:100 },
      { id:'s3',member_id:'m2',status:'confirmed',start_date:'2026-10-01',end_date:'2026-11-01',final_amount:0 },
    ],
    payments: [
      { membership_id:'s1',amount:100,kind:'payment',paid_at:'2026-10-27T00:00:00Z' },
      { membership_id:'s1',amount:20,kind:'refund',paid_at:'2026-10-27T00:10:00Z' },
      { membership_id:'s2',amount:100,kind:'payment',paid_at:'2026-10-10T00:00:00Z' },
      { membership_id:'s1',amount:900,kind:'payment',paid_at:'2026-12-01T00:00:00Z' },
    ],
    attendance:[
      {member_id:'m1',punched_at:'2026-10-26T19:00:00Z',access_result:'allowed'},
      {member_id:'m1',punched_at:'2026-10-26T20:00:00Z',access_result:'allowed'},
      {member_id:'m2',punched_at:'2026-10-26T20:00:00Z',access_result:'restricted'},
    ],
  },{ role:'admin',days:7,now });
  assert.equal(result.metrics.activeMembers,1);
  assert.equal(result.metrics.revenue,80);
  assert.equal(result.metrics.presentToday,1);
  assert.equal(result.metrics.renewalDue,0);
  assert.equal(result.metrics.pending,20);
  assert.equal(result.series.at(-1).visits,1);
});

test('trainer payload excludes financials, other staff, and membership data', () => {
  const d=demoDashboard('trainer',7,new Date('2026-10-27T10:00:00Z'));
  assert.equal(d.preview,true);
  assert.equal(d.currentStaff.role,'trainer');
  assert.equal(d.members.length,12);
  for(const key of ['payments','balances','renewals','planMix','enquiries','syncJobs','auditLogs']) assert.equal(d[key],undefined);
  assert.equal(d.metrics.revenue,undefined);
  assert.ok(d.series.every(p=>!('revenue' in p)));
});

test('portal enforces session, staff role, pagination, cookie flags, CSRF and logout', async () => {
  process.env.SUPABASE_URL='https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  let active=true;
  const calls=[];
  const mock = async (url,opts) => {
    const u=new URL(url); calls.push({url:u,opts});
    if(u.pathname==='/auth/v1/token') return new Response(JSON.stringify({access_token:'user-token',refresh_token:'refresh-token',expires_in:3600,user:{id:'user-1'}}));
    if(u.pathname==='/auth/v1/logout') return new Response(null,{status:204});
    if(u.pathname==='/rest/v1/staff') return Response.json(active?[{id:'staff-1',user_id:'user-1',gym_id:'gym-1',full_name:'Reception',role:'receptionist',is_active:true}]:[]);
    if(u.pathname==='/rest/v1/members') {
      const offset=Number(u.searchParams.get('offset'));
      return Response.json(Array.from({length:Math.min(500,Math.max(0,1001-offset))},(_,i)=>({id:`m${offset+i}`,full_name:'Example',created_at:'2026-01-01',is_archived:false})));
    }
    return Response.json([]);
  };
  const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/portal`;
  try {
    assert.equal((await fetch(`${base}/dashboard`)).status,401);
    const csrf=await fetch(`${base}/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});
    assert.equal(csrf.status,403);
    const login=await fetch(`${base}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'private-test'})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    const headers={Cookie:cookie.split(';')[0]};
    for(const endpoint of ['staff','import-snapshot']){
      const denied=await fetch(`${base}/${endpoint}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      assert.equal(denied.status,403,`receptionist cannot write ${endpoint}`);
    }
    const dashboard=await fetch(`${base}/dashboard?days=7`,{headers});
    assert.equal(dashboard.status,200);
    const data=await dashboard.json();assert.equal(data.metrics.totalMembers,1001);assert.equal(data.role,'receptionist');
    assert.equal(data.currentStaff.full_name,'Reception');
    assert.equal(data.syncJobs,undefined);
    assert.ok(!calls.some(c=>c.url.pathname==='/rest/v1/audit_logs'));
    assert.ok(calls.filter(c=>c.url.pathname.startsWith('/rest/')).every(c=>c.opts.headers.Authorization==='Bearer user-token'));
    active=false;
    assert.equal((await fetch(`${base}/dashboard`,{headers})).status,403);
    active=true;
    assert.equal((await fetch(`${base}/logout`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,200);
    assert.equal((await fetch(`${base}/session`,{headers})).status,401);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('all dashboard page templates render across roles, including empty and escaped data', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,
      addEventListener(){},setAttribute(){},focus(){},setSelectionRange(){},classList:{add(){},remove(){},toggle(){return false;}} });
    return elements.get(selector);
  };
  const context=vm.createContext({
    console,Intl,Date,URLSearchParams,URL,Blob,setTimeout,clearTimeout,setInterval(){},
    location:{search:'?preview=admin',pathname:'/dashboard/'},history:{replaceState(){}},
    document:{querySelector:element,addEventListener(){},body:{classList:{add(){},remove(){}}}},
    window:{scrollTo(){}},fetch:async()=>Response.json(demoDashboard()),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/whatsapp-templates.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/messages.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/management.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/leads.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/review-members.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/pt.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/app.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(element('#pageBody').innerHTML.includes('Daily updates'));
  assert.ok(element('#pageBody').innerHTML.includes('Receptionist updates'));
  const orderedNav=['overview','finance','admissions','renewed','renewals','pt','enquiries','leads','messages','fingerprint','attendance'];
  const adminNav=element('#mainNav').innerHTML;
  for(let i=1;i<orderedNav.length;i++)assert.ok(adminNav.indexOf(`data-go="${orderedNav[i-1]}"`)<adminNav.indexOf(`data-go="${orderedNav[i]}"`));
  assert.ok(!/data-overview-section="[^"]+" open/.test(element('#pageBody').innerHTML));
  vm.runInContext("state.overviewSections={dailyUpdates:true};renderPage();",context);
  assert.ok(element('#pageBody').innerHTML.includes('data-overview-section="dailyUpdates" open'));
  vm.runInContext('renderPage();',context);
  assert.ok(element('#pageBody').innerHTML.includes('data-overview-section="dailyUpdates" open'));
  context.testParameters={memberParameters:{asOf:'2026-10-28',from:'2026-10-01',to:'2026-10-28',memberGender:[{label:'Male',count:3},{label:'Female',count:1}],renewalGender:[],areas:[{label:'<img src=x>',count:1}]}};
  const chartHtml=vm.runInContext('renderParameterCharts(testParameters)',context);
  assert.ok(chartHtml.includes('conic-gradient'));assert.ok(chartHtml.includes('75.0%'));assert.ok(chartHtml.includes('&lt;img'));assert.ok(!chartHtml.includes('<img'));
  context.testActivity={receptionActivity:[{section:'Review Members',person_name:'<script>alert(1)</script>',staff_name:'Reception',created_at:'2026-10-28T01:00:00Z',status:'Interested',remark:'<img src=x onerror=alert(1)>'}]};
  const activityHtml=vm.runInContext('receptionActivitySection(testActivity)',context);
  assert.ok(activityHtml.includes('&lt;script&gt;'));assert.ok(!activityHtml.includes('<img'));
  assert.equal(element('#userName').textContent,'Zenith Admin');
  for(const role of ['admin','receptionist','trainer']){
    context.testData=demoDashboard(role);
    vm.runInContext('state.role=testData.role; state.data=testData;',context);
    const pages=role==='admin'?['overview','parameters','sales','admissions','renewals','renewed','review','pt','members','attendance','finance','pending','expenses','enquiries','leads','team','fingerprint','messages','operations']:role==='trainer'?['overview','members','attendance']:['admissions','renewed','renewals','pt','enquiries','leads','attendance','review','members','pending','expenses'];
    for(const page of pages){
      vm.runInContext(`navigate('${page}')`,context);
      if(page==='fingerprint')assert.ok(element('#pageBody').innerHTML.includes('src="/fingerprint/?embedded=1"'));
      else assert.ok(element('#pageBody').innerHTML.length>100);
      assert.ok(!element('#pageBody').innerHTML.includes('NaN'));
    }
    if(role==='receptionist'){
      const nav=element('#mainNav').innerHTML;
      for(const key of ['admissions','renewed','renewals','pt','enquiries','leads','attendance','review','members','pending','expenses'])assert.ok(nav.includes(`data-go="${key}"`));
      for(const key of ['finance','sales','team','messages','fingerprint','overview'])assert.ok(!nav.includes(`data-go="${key}"`));
      vm.runInContext('navigate("pt");',context);assert.equal(vm.runInContext('state.page',context),'pt');
      assert.ok(element('#pageBody').innerHTML.includes('New PT package'));
      vm.runInContext('navigate("finance");',context);assert.equal(vm.runInContext('state.page',context),'admissions');
      assert.equal(element('#exportButton').hidden,true);assert.equal(element('#exportButton').disabled,true);
      assert.doesNotThrow(()=>vm.runInContext('exportReport();exportManagementReport();',context));
      assert.equal(element('#toast').textContent,'Report export is not available for reception.');
    }
  }
  context.testWeekly={...demoDashboard('receptionist'),weeklyAttendance:{from:'2026-10-21',to:'2026-10-27',today:'2026-10-28',allCovered:true,imported_at:'2026-10-28T04:00:00Z',days:[{day:'2026-10-27',covered:true,active_count:1,present_count:0,absentees:[{member_name:'Absent Member',admission_id:'ZF-1',phone:'9000000000'}]}],consecutive:[{member_name:'Absent Member',admission_id:'ZF-1',phone:'9000000000'}],attendance:[{member_name:'Today Member',admission_id:'ZF-2',phone:'8000000000',punched_at:'2026-10-28T03:00:00Z'}]}};
  vm.runInContext('state.data=testWeekly;state.role="receptionist";state.attendanceMode="attendance";state.attendanceDay="2026-10-28";navigate("attendance");',context);
  assert.equal(vm.runInContext('attendanceViewRows(state.data).length',context),1);assert.ok(element('#pageBody').innerHTML.includes('tel:+918000000000'));
  vm.runInContext('state.attendanceMode="consecutive";renderPage();',context);assert.ok(element('#pageBody').innerHTML.includes('Absent Member'));assert.ok(element('#pageBody').innerHTML.includes('tel:+919000000000'));
  context.testData={...demoDashboard('admin'),today:'2026-10-28',reviewMembers:[{id:'date-test',member_id:'m0',member_name:'Date filter member',admission_id:'ZF-1',phone:'9000000000',start_date:'2026-08-01',end_date:'2026-08-31',expiry_month:'2026-08',review_status:'Interested',reason:'Busy schedule',return_date:'2026-11-05',next_follow_up_date:'2026-10-29',remark:'Test',returned:false}]};
  vm.runInContext('state.data=testData;state.role="admin";state.filters={};navigate("review");',context);
  assert.equal(vm.runInContext('reviewRows().length',context),0,'last-month default excludes August');
  vm.runInContext('filtersForPage().reviewDate="2026-10-29";filtersForPage().reviewDateType="followup";renderPage();',context);
  assert.equal(vm.runInContext('reviewRows().length',context),1,'exact date works across expiry months');assert.ok(element('#pageBody').innerHTML.includes('type="date" id="reviewSelectedDate"'));
  vm.runInContext('filtersForPage().reviewDate="2026-08-31";filtersForPage().reviewDateType="expiry";',context);assert.equal(vm.runInContext('reviewRows().length',context),1);
  vm.runInContext('filtersForPage().reviewDate="2026-11-05";filtersForPage().reviewDateType="return";',context);assert.equal(vm.runInContext('reviewRows().length',context),1);
  vm.runInContext('filtersForPage().reviewDate="2026-11-06";',context);assert.equal(vm.runInContext('reviewRows().length',context),0);
  context.testData={staff:{full_name:'Admin'},...buildDashboard({members:[]},{role:'admin',days:7})};
  vm.runInContext('state.role="admin";state.data=testData;navigate("overview");',context);
  assert.ok(element('#pageBody').innerHTML.includes('Total members'));
  context.testData=demoDashboard('admin');
  context.testData.members[0].full_name='<img src=x onerror=alert(1)>';
  vm.runInContext('state.data=testData;navigate("members");',context);
  assert.ok(element('#pageBody').innerHTML.includes('&lt;img'));
  assert.ok(!element('#pageBody').innerHTML.includes('<img'));
  context.testData=demoDashboard('admin');
  vm.runInContext('state.data=testData;navigate("members");state.search="Aarav";',context);
  assert.equal(vm.runInContext('managementRows("members").length',context),1);
  vm.runInContext('state.search="";state.filters.members={status:"Inactive"};',context);
  assert.ok(vm.runInContext('managementRows("members").every(m=>m.membership_status==="Inactive")',context));
  vm.runInContext('navigate("sales");state.filters.sales={month:"1900-01"};',context);
  assert.equal(vm.runInContext('managementRows("sales").length',context),0);
  context.testData=demoDashboard('admin');
  vm.runInContext('state.data=testData;state.role="admin";navigate("admissions");',context);
  assert.ok(vm.runInContext('managementRows("admissions").every(m=>m.kind==="admission")',context));
  assert.ok(element('#pageBody').innerHTML.includes('WHATSAPP MESSAGE'));
  assert.ok(element('#pageBody').innerHTML.includes('https://wa.me/91'));
  vm.runInContext('navigate("renewed");',context);
  assert.ok(vm.runInContext('managementRows("renewed").length>0 && managementRows("renewed").every(m=>m.kind==="renewal"&&m.status==="confirmed")',context));
  assert.ok(element('#pageBody').innerHTML.includes('RENEWED ON'));
  assert.ok(element('#pageBody').innerHTML.includes('successfully renewed'));
  vm.runInContext('state.data.whatsappTemplates=[{template_key:"renewed",body:"Custom renewal for {{member_name}}"}];renderPage();',context);
  assert.ok(element('#pageBody').innerHTML.includes('Custom renewal for'));
  vm.runInContext('navigate("renewals");state.filters.renewals={renewalMonth:""};renderPage();',context);
  assert.ok(element('#pageBody').innerHTML.includes('WHATSAPP MESSAGE'));
  assert.ok(vm.runInContext('managementRows("renewals").every(m=>Boolean(m.expiry_month))',context));
  context.messageRow={member_id:'m0',member_name:'A & B <example>',admission_id:'ZF-1',package_group:'30',start_date:'2026-10-27',end_date:'2026-11-26',phone:'+91 90000 00000',status:'confirmed'};
  const wa=vm.runInContext('membershipWhatsApp(messageRow,"admissions")',context);
  const url=new URL(wa.url);assert.equal(url.pathname,'/919000000000');assert.equal(url.searchParams.get('text'),wa.message);
  assert.ok(wa.message.includes('A & B <example>'));
  assert.ok(vm.runInContext('whatsappColumn(messageRow,"admissions")',context).includes('A &amp; B &lt;example&gt;'));
  vm.runInContext('messageRow.phone="invalid"',context);
  assert.equal(vm.runInContext('membershipWhatsApp(messageRow,"renewed").url',context),null);
  vm.runInContext('messageRow.phone="9000000000";messageRow.status="cancelled"',context);
  assert.ok(!vm.runInContext('whatsappColumn(messageRow,"admissions")',context).includes('https://wa.me/'));
  context.lead={full_name:'Example',status:'new',lead_status:'Call Later',follow_up_date:'2026-10-20',next_follow_up_date:'2026-10-27',remark:'Call in evening'};
  assert.equal(vm.runInContext('leadMatches(lead,"Today","2026-10-27")',context),true);
  assert.equal(vm.runInContext('leadMatches(lead,"Overdue","2026-10-27")',context),false);
  vm.runInContext('lead.lead_status="Admission Done"',context);
  assert.equal(vm.runInContext('leadMatches(lead,"Today","2026-10-27")',context),false);
  assert.equal(vm.runInContext('leadMatches(lead,"Admission Done","2026-10-27")',context),true);
  context.lead.phone='9000000000';assert.match(vm.runInContext('leadWhatsApp(lead)',context),/^https:\/\/wa.me\/91/);
});

test('historical opening balances do not inflate collections and unknown debts stay unknown',()=>{
  const d=buildDashboard({members:[{id:'m1',created_at:'2026-01-01'}],memberships:[
    {id:'s1',member_id:'m1',kind:'admission',start_date:'2026-01-01',end_date:'2026-12-31',status:'confirmed',final_amount:null,historical_charge:1000,accounting_verified:true,opening_paid_amount:750},
    {id:'s2',member_id:'m1',kind:'renewal',start_date:'2026-01-01',end_date:'2026-12-31',status:'confirmed',final_amount:5000,accounting_verified:false},
  ],historicalReceipts:[{id:'r1',received_at:'2026-10-20T10:00:00Z',amount:750,description:'Source collection'}],payments:[],expenses:[{expense_date:'2026-10-20',amount:100,status:'recorded'}]}, {role:'admin',days:30,now:new Date('2026-10-27T10:00:00Z')});
  assert.equal(d.metrics.revenue,750);
  assert.equal(d.metrics.pending,250);
  assert.equal(d.metrics.unreconciledPeriods,1);
  assert.equal(d.monthlySales.find(m=>m.month==='2026-10').cashBalance,650);
});

test('real snapshot is authenticated, tenant-scoped, and unavailable to unassigned trainers',async()=>{
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  let role='admin',gym='b80cd818-2abe-4a90-9027-e2ba1916aec4';
  const mock=async url=>{
    const p=new URL(url).pathname;
    if(p==='/auth/v1/token')return Response.json({access_token:'token',refresh_token:'refresh',expires_in:3600,user:{id:'user-1'}});
    if(p==='/rest/v1/staff')return Response.json([{id:'s1',gym_id:gym,user_id:'user-1',full_name:'Staff',role,is_active:true}]);
    if(p==='/rest/v1/members')return Response.json({code:'PGRST204',message:'New management columns not installed'},{status:400});
    return Response.json([]);
  };
  const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/portal`;
  try{
    assert.equal((await fetch(`${base}/source-dashboard`)).status,401);
    const login=await fetch(`${base}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'test'})});
    const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
    const real=await(await fetch(`${base}/dashboard`,{headers})).json();
    assert.equal(real.metrics.totalMembers,652);assert.equal(real.source.type,'spreadsheet_snapshot');assert.equal(real.source.readOnly,true);
    assert.equal(real.preview,undefined);assert.ok(!JSON.stringify(real).includes('medical_history'));
    role='trainer';const trainer=await(await fetch(`${base}/dashboard`,{headers})).json();
    assert.equal(trainer.members.length,0);assert.equal(trainer.payments,undefined);
    role='admin';gym='another-gym';assert.equal((await fetch(`${base}/source-dashboard`,{headers})).status,404);
    assert.equal((await fetch(`${base}/import-snapshot`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('custom date overview uses inclusive India dates, channel splits and as-of member status',()=>{
  const now=new Date('2026-10-27T10:00:00Z');
  const d=buildDashboard({members:[{id:'m1',created_at:'2026-09-01T00:00:00Z'},{id:'m2',created_at:'2026-09-01T00:00:00Z'},{id:'future',created_at:'2026-10-27T00:00:00Z'}],
    memberships:[{id:'s1',member_id:'m1',kind:'admission',status:'confirmed',start_date:'2026-10-01',end_date:'2026-10-31',purchased_at:'2026-10-01T00:00:00Z',final_amount:100},
      {id:'s2',member_id:'m2',kind:'renewal',status:'confirmed',start_date:'2026-10-25',end_date:'2026-11-24',purchased_at:'2026-10-25T18:45:00Z',final_amount:100}],
    payments:[{membership_id:'s1',amount:100,kind:'payment',payment_mode:'Cash',paid_at:'2026-10-25T18:30:00Z'},
      {membership_id:'s2',amount:200,kind:'payment',payment_mode:'UPI',paid_at:'2026-10-26T18:29:59Z'},
      {membership_id:'s2',amount:50,kind:'refund',payment_mode:'Card',paid_at:'2026-10-26T05:00:00Z'},
      {membership_id:'s1',amount:999,kind:'payment',payment_mode:'Cash',paid_at:'2026-10-26T18:30:00Z'}]},
    {role:'admin',now,from:'2026-10-26',to:'2026-10-26'});
  assert.equal(d.gymOverview.cashCollected,100);assert.equal(d.gymOverview.onlineCollected,150);assert.equal(d.gymOverview.totalCollected,250);
  assert.equal(d.gymOverview.dailyRenewals,1);assert.equal(d.gymOverview.weeklyRenewals,1);assert.equal(d.gymOverview.monthlyAdmissions,1);
  assert.equal(d.gymOverview.totalMembers,2);assert.equal(d.gymOverview.activeMembers,2);assert.equal(d.gymOverview.inactiveMembers,0);
  assert.throws(()=>reportRange('2026-02-30','2026-03-01',now));
  assert.throws(()=>reportRange('2026-10-27','2026-10-26',now));
  assert.throws(()=>reportRange('2026-10-27','2026-10-28',now));
});

test('package grouping recognizes fixed-day and calendar packages and isolates custom durations',()=>{
  for(const [start,end,code] of [['2026-01-01','2026-01-31','30'],['2026-01-31','2026-04-30','90'],['2026-01-01','2026-06-30','180'],['2024-01-01','2025-01-01','365']])assert.equal(packageGroup({start_date:start,end_date:end}),code);
  assert.equal(packageGroup({start_date:'2026-01-01',end_date:'2026-02-15'},{name:'1 Month'}),'custom');
  assert.equal(packageGroup({start_date:'2026-01-01',end_date:'2026-01-31'},{code:'custom'}),'custom');
});

test('renewed members move to their next expiry month while renewal history remains',()=>{
  const d=buildDashboard({members:[{id:'m',full_name:'Example',created_at:'2026-01-01'}],memberships:[
    {id:'old',member_id:'m',kind:'admission',status:'confirmed',start_date:'2026-10-01',end_date:'2026-10-31'},
    {id:'new',member_id:'m',kind:'renewal',status:'confirmed',start_date:'2026-11-01',end_date:'2026-12-01'}]}, {role:'admin',now:new Date('2026-10-27T10:00:00Z')});
  assert.equal(d.renewalSchedule.length,1);assert.equal(d.renewalSchedule[0].expiry_month,'2026-12');assert.equal(d.memberships.length,2);
});

test('admission and renewal forms save only to Supabase and retain request IDs across retries',async()=>{
  const storage=new Map(),calls=[];let failed=true;
  const context=vm.createContext({window:{},location:{protocol:'http:'},FormData,crypto:require('node:crypto').webcrypto,
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(failed){failed=false;throw new Error('Connection interrupted');}return Response.json({success:true,admissionId:'ZF-999'});},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dashboard-form-sync.js'),'utf8'),context);
  context.form=new FormData();context.form.append('action','admission');context.form.append('name','Example');
  await assert.rejects(vm.runInContext('window.submitToZenithDatabase(form)',context));
  const response=await vm.runInContext('window.submitToZenithDatabase(form)',context);
  assert.equal(JSON.parse(await response.text()).success,true);assert.equal(calls[0].body.requestId,calls[1].body.requestId);
  assert.ok(calls.every(c=>c.url==='/api/portal/form-submit'));assert.equal(storage.size,0);
  context.form=new FormData();context.form.append('action','saveRenewal');await vm.runInContext('window.submitToZenithDatabase(form)',context);
  assert.equal(calls.at(-1).body.action,'saveRenewal');
});

test('form API validates staff and payments, classifies custom packages and saves via the Supabase RPC only',async()=>{
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  const calls=[];let role='receptionist';
  const plan='fa000000-0000-4000-8000-000000000001',custom='fa000000-0000-4000-8000-000000000002',member='fa000000-0000-4000-8000-000000000003';
  const mock=async(url,opts)=>{
    const u=new URL(url);calls.push({url:u,opts});
    if(u.pathname==='/auth/v1/token')return Response.json({access_token:'staff-token',refresh_token:'refresh',expires_in:3600,user:{id:'user-1'}});
    if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff-1',gym_id:'gym-1',full_name:'Staff',user_id:'user-1',role,is_active:true}]);
    if(u.pathname==='/rest/v1/membership_plans')return Response.json(u.searchParams.get('select')==='name'?[{name:'1 Month'}]:[{id:u.searchParams.get('code')==='eq.custom'?custom:plan}]);
    if(u.pathname==='/rest/v1/members')return Response.json([{id:member,admission_id:'ZF-1000',full_name:'Example',phone:'9000000000'}]);
    if(u.pathname==='/rest/v1/memberships')return Response.json([{end_date:'2026-11-26',plan_id:plan}]);
    if(u.pathname==='/rest/v1/rpc/submit_gym_form')return Response.json({success:true,admissionId:'ZF-1000',membershipId:'period-1'});
    if(u.pathname==='/rest/v1/rpc/submit_split_gym_form')return Response.json({success:true,admissionId:'ZF-1000',membershipId:'period-1'});
    if(u.pathname==='/rest/v1/rpc/submit_enquiry')return Response.json({success:true,enquiryId:member});
    if(u.pathname==='/rest/v1/rpc/update_enquiry_followup')return Response.json({success:true});
    if(u.pathname==='/rest/v1/enquiry_followups')return Response.json([]);
    throw new Error('Unexpected upstream request');
  };
  const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/portal`;
  try{
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'staff@example.com',password:'test'})});
    const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
    const body={action:'admission',requestId:'fa000000-0000-4000-8000-000000000099',name:'Example',mobile:'9000000000',plan:'30',startDate:'2026-10-27',endDate:'2026-11-26',totalAmount:1000,discount:0,finalAmount:1000,amountPaid:600,pendingAmount:400,paymentMode:'Cash'};
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
    let rpc=calls.filter(c=>c.url.pathname==='/rest/v1/rpc/submit_gym_form').at(-1);
    let payload=JSON.parse(rpc.opts.body);assert.equal(payload.payload.plan_id,plan);assert.equal(payload.payload.paid_amount,600);assert.equal(payload.request_uuid,body.requestId);
    const before=calls.filter(c=>c.url.pathname.includes('/rpc/')).length;
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify({...body,amountPaid:1001,pendingAmount:-1})})).status,400);
    assert.equal(calls.filter(c=>c.url.pathname.includes('/rpc/')).length,before);
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify({...body,endDate:'2026-11-10'})})).status,200);
    rpc=calls.filter(c=>c.url.pathname.includes('/rpc/')).at(-1);assert.equal(JSON.parse(rpc.opts.body).payload.plan_id,custom);
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify({...body,action:'saveRenewal',admissionId:'ZF-1000',amount:1000})})).status,200);
    rpc=calls.filter(c=>c.url.pathname.includes('/rpc/')).at(-1);assert.equal(JSON.parse(rpc.opts.body).payload.member_id,member);
    const lookup=await(await fetch(base+'/member-lookup?admissionId=ZF-1000',{headers})).json();assert.equal(lookup.endDate,'26-11-2026');
    for(const action of ['admission','saveRenewal']){
      const splitBody={...body,action,admissionId:'ZF-1000',paymentMode:'Cash + Online',cashCollected:200,onlineCollected:400};
      assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify(splitBody)})).status,200);
      const splitCall=calls.at(-1);assert.equal(splitCall.url.pathname,'/rest/v1/rpc/submit_split_gym_form');
      const splitPayload=JSON.parse(splitCall.opts.body).payload;assert.equal(splitPayload.cash_collected,200);assert.equal(splitPayload.online_collected,400);assert.equal(splitPayload.paid_amount,600);
      for(const wrong of [{cashCollected:201},{onlineCollected:-1},{onlineCollected:''},{cashCollected:'NaN'},{cashCollected:200.001,onlineCollected:399.999}])assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify({...splitBody,...wrong})})).status,400);
    }
    const enquiry={action:'enquire',requestId:body.requestId,name:'Enquiry Example',contact:'9000000000',email:'example@example.com',address:'Example address',interestedIn:'Gym',source:'Referral',followUpDate:'2026-10-28',message:'Evening trial'};
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify(enquiry)})).status,200);
    const enquiryCall=calls.filter(c=>c.url.pathname==='/rest/v1/rpc/submit_enquiry').at(-1);
    const enquiryPayload=JSON.parse(enquiryCall.opts.body).payload;assert.equal(enquiryPayload.address,'Example address');assert.equal(enquiryPayload.email,'example@example.com');assert.equal(enquiryPayload.source,'Referral');assert.equal(enquiryPayload.notes,'Evening trial');
    assert.equal((await fetch(base+`/enquiries/${member}`,{method:'PATCH',headers,body:JSON.stringify({lead_status:'Call Later',next_follow_up_date:'2026-10-29',remark:'Call after 5'})})).status,200);
    assert.equal((await fetch(base+'/enquiries/import-history',{method:'POST',headers,body:'{}'})).status,403);
    assert.equal((await fetch(base+'/pending/reconcile',{method:'POST',headers,body:'{}'})).status,403);
    role='trainer';assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify(body)})).status,403);
    assert.equal((await fetch(base+'/form-submit',{method:'POST',headers,body:JSON.stringify(enquiry)})).status,403);
    assert.equal((await fetch(base+`/enquiries/${member}/history`,{headers})).status,403);
    assert.ok(calls.every(c=>c.url.hostname==='test.supabase.co'));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
