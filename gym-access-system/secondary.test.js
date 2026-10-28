const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HEADERS,projectFallback}=require('./fallbackProjection');
const {writeFallback}=require('./fallbackMirror');
const {deviceTargets,syncFingerprint}=require('./supabaseFingerprint');
const {validateAccessDate}=require('./supabaseFingerprint');
const {deviceName,storedNameMatches,verifiedUserMatches}=require('./supabaseFingerprint');
test('device name verification normalizes imported whitespace and retains strict identity checks',()=>{
 const target={uid:10,userId:'10',name:'Rashmi Sabale '};
 assert.equal(deviceName(' Rashmi Sabale '),'Rashmi Sabale');
 assert.equal(verifiedUserMatches({uid:10,userId:'10',name:'Rashmi Sabale '},target),true);
 assert.equal(verifiedUserMatches({uid:11,userId:'10',name:'Rashmi Sabale'},target),false);
 assert.equal(verifiedUserMatches({uid:10,userId:'11',name:'Rashmi Sabale'},target),false);
 assert.equal(verifiedUserMatches({uid:10,userId:'10',name:'Different member'},target),false);
 const name=deviceName('A very long name beyond twenty four bytes');assert.ok(Buffer.byteLength(name)<=24);
 const fullWidth='abcdefghijklmnopqrstuvwx';assert.equal(storedNameMatches(fullWidth+'A\0',fullWidth),true);
 const unicode='José';assert.equal(storedNameMatches(Buffer.from(unicode).toString('ascii'),unicode),true);
});
test('matching names with trailing spaces do not trigger an unnecessary device rewrite',async()=>{
 const s=sample();s.members[0].full_name='Rashmi Sabale ';const a=adapter([{uid:661,userId:'661',name:'Rashmi Sabale'}]);
 await syncFingerprint(s,[{payload:{member_id:'m'}}],a);assert.equal(a.calls.some(c=>Array.isArray(c)&&c[0]==='upsert'),false);
});
const {createSecondaryBridge}=require('./secondaryBridge');
const {TEAM_ZENITH,ZENITH_GYM_ID}=require('./reservedDeviceIds');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
test('Apps Script creates exactly six sheets and rerunning preserves the counter/workbook',()=>{
 let created=0;const properties=new Map();const tabs=[];
 function sheet(title){const cells=new Map();let filter=false;
  const sh={title,getLastRow:()=>cells.size?1:0,getMaxRows:()=>1000,getFilter:()=>filter,setName(name){sh.title=name;return sh;},setFrozenRows(){},setRowHeight(){},setTabColor(){},setColumnWidths(){},setColumnWidth(){},getRange(...args){const key=args.join(',');
   const range={setValues(value){cells.set(key,value);return range;},getValue:()=>key==='A2'?(cells.get('A2:B6')?.[0]?.[0]||''):'',createFilter(){filter=true;return range;}};
   for(const name of ['setFontWeight','setBackground','setFontColor','setFontSize','setNumberFormat','setFontFamily','setNote'])range[name]=()=>range;return range;}};
  tabs.push(sh);return sh;
 }
 const ss={getId:()=> 'new-book',getUrl:()=> 'https://docs.google.com/spreadsheets/d/new-book',setSpreadsheetTimeZone(){},getSheets:()=>tabs,getSheetByName:name=>tabs.find(s=>s.title===name),insertSheet:sheet};
 const context=vm.createContext({console:{log(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},SpreadsheetApp:{create:()=>{created++;sheet('Sheet1');return ss;},openById:()=>ss}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/create-fallback-workbook.gs'),'utf8'),context);
 vm.runInContext('createZenithFallbackWorkbook()',context);vm.runInContext('createZenithFallbackWorkbook()',context);
 assert.equal(created,1);assert.deepEqual(tabs.map(t=>t.title),Object.keys(HEADERS));assert.equal(properties.get('ZENITH_FALLBACK_SETUP_COMPLETE'),'1');
});
test('fingerprint screen clearly reports success, failure, busy and unconfirmed responses',async()=>{
 for(const scenario of ['success','failure','busy','unconfirmed']){
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',dataset:{},disabled:false,hidden:false,classList:{toggle(){}},replaceChildren(){},append(){},scrollIntoView(){},focus(){}});return elements.get(id);};
  const context=vm.createContext({Intl,Date,Error,Number,document:{getElementById:element,createElement:()=>({append(){},textContent:''})},fetch:async url=>{
   if(url.endsWith('/session'))return Response.json({staff:{role:'admin'}});
   if(url.includes('/secondary-sync/preview'))return Response.json({devices:[{name:'Member',uid:661,active:true}]});
   if(scenario==='failure')return Response.json({error:'Device offline'},{status:503});
   if(scenario==='busy')return Response.json({busy:true});
   return Response.json({success:scenario==='success',accessDate:'2026-10-28',processed:3,accessAllowed:1,accessRestricted:1,protectedTeam:1});
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/fingerprint/sync.js'),'utf8'),context);await new Promise(r=>setImmediate(r));
  await element('syncButton').onclick();
  assert.equal(element('status').dataset.state,scenario==='success'?'success':scenario==='busy'?'warning':'error');
  assert.match(element('status').textContent,scenario==='success'?/SYNC SUCCESSFUL/:scenario==='busy'?/SYNC NOT STARTED/:/SYNC FAILED/);
  assert.equal(element('syncButton').disabled,false);
 }
});
function sample(){return {gym_id:'gym-a',generated_at:'2026-10-27T09:00:00Z',last_admission_id:661,
 members:[{id:'m',admission_id:'ZF-661',device_user_id:661,full_name:'=Member',phone:'9000000000',category:'Regular'}],
 plans:[{id:'p',name:'1 Month'}],memberships:[{id:'period',member_id:'m',plan_id:'p',kind:'admission',status:'confirmed',start_date:'2026-10-01',end_date:'2026-10-31',final_amount:1000,opening_paid_amount:0,accounting_verified:true}],
 payments:[{id:'cash',membership_id:'period',amount:200,kind:'payment',payment_mode:'Cash',paid_at:'2026-10-27T09:00:00Z'},{id:'online',membership_id:'period',amount:500,kind:'payment',payment_mode:'Online',paid_at:'2026-10-27T09:00:00Z'}],ptContracts:[],ptPayments:[],historicalReceipts:[]};}
test('Team Zenith IDs remain in Database without advancing last admission beyond 660',()=>{
 const s=sample();s.gym_id=ZENITH_GYM_ID;s.last_admission_id=2996;s.members[0].device_user_id=660;s.members[0].admission_id='ZF-660';
 s.members.push(...TEAM_ZENITH.map(([uid,name])=>({id:'team-'+uid,admission_id:'ZF-'+uid,device_user_id:uid,full_name:name})));
 const p=projectFallback(s);assert.equal(p['System Control'][1][1],660);assert.equal(p.Database.length,14);
 assert.equal(p.Database.filter(r=>r[0]==='ZF-2996').length,1);assert.equal(p['Renewal List'].length,2);
});
test('Team Zenith jobs preserve device accounts and access without contacting hardware',async()=>{
 const s=sample();s.gym_id=ZENITH_GYM_ID;s.members=[{id:'team',admission_id:'ZF-2987',device_user_id:2987,full_name:'Lakhan (TZ)'}];s.memberships=[];
 const a=adapter();const result=await syncFingerprint(s,[{payload:{member_id:'team'}}],a);assert.equal(result.protectedTeam,1);assert.deepEqual(a.calls,[]);
 s.gym_id='other-gym';assert.equal(deviceTargets(s,['team'],'2026-10-27')[0].protectedTeam,false);
});
test('six fallback tabs preserve paid/pending, cash split and stable IDs',()=>{
 const s=sample(),p=projectFallback(s);assert.deepEqual(Object.keys(p),Object.keys(HEADERS));
 assert.equal(p.Admissions[1][0],'ZF-661');assert.equal(p.Admissions[1][6],700);assert.equal(p.Admissions[1][7],300);
 assert.match(p.Admissions[1][8],/Cash 200.00 \+ Online 500.00/);assert.equal(p.Admissions[1][9],'Partial');
 assert.equal(p['Daily Cash Book'].length,3);assert.equal(p['Daily Cash Book'].slice(1).reduce((n,r)=>n+r[3],0),700);
 assert.equal(p['System Control'][1][1],661);assert.deepEqual(p.Database[1],['ZF-661','=Member','2026-10-31']);assert.equal(p.Admissions[1][11].startsWith('https://wa.me/919000000000?'),true);
 assert.deepEqual(projectFallback(s),p,'Re-projecting never appends duplicates');
});
test('renewal list uses latest expiry while admissions and renewals retain their history',()=>{
 const s=sample();s.memberships.push({...s.memberships[0],id:'renewal',kind:'renewal',start_date:'2026-11-01',end_date:'2026-11-30'});
 const p=projectFallback(s);assert.equal(p.Admissions.length,2);assert.equal(p.Renewals.length,2);assert.deepEqual(p['Renewal List'][1],['ZF-661','=Member','2026-11-30']);assert.equal(p.Database[1][2],'2026-11-30');
});
test('historical opening balances do not duplicate cashbook receipts; unknown dues remain unknown',()=>{
 const s=sample();s.memberships[0].opening_paid_amount=100;s.historicalReceipts=[{id:'h',received_at:'2026-10-01T09:00:00Z',amount:100,description:'Old receipt',payment_mode:'Cash'}];
 let p=projectFallback(s);assert.equal(p.Admissions[1][6],800);assert.equal(p.Admissions[1][7],200);assert.equal(p['Daily Cash Book'].slice(1).reduce((n,r)=>n+r[3],0),800);
 s.memberships[0].accounting_verified=false;p=projectFallback(s);assert.equal(p.Admissions[1][7],'');assert.equal(p.Admissions[1][9],'Needs review');
});
function sheetsMock({wrongHeader=false,wrongGym=false,fail=false}={}){const calls=[];return {calls,spreadsheets:{
 get:async()=>({data:{sheets:Object.keys(HEADERS).map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000,columnCount:26}}}))}}),
 values:{batchGet:async()=>({data:{valueRanges:[...Object.entries(HEADERS).map(([name,headers])=>({values:[wrongHeader&&name==='Admissions'?['wrong']:headers]})),{values:[['GymID',wrongGym?'other':'gym-a'],['SchemaVersion','zenith-fallback-v1']]}]}})},
 batchUpdate:async args=>{calls.push(args);if(fail)throw new Error('Google unavailable');return {};}
 }};}
test('mirror uses one atomic replacement batch, literal strings and no append API',async()=>{
 const sheets=sheetsMock(),args={sheets,spreadsheetId:'new-fallback-workbook-id-12345',snapshot:sample()};await writeFallback(args);await writeFallback(args);
 assert.equal(sheets.calls.length,2);assert.deepEqual(sheets.calls[0],sheets.calls[1]);const update=sheets.calls[0].requestBody.requests[0].updateCells;
 assert.equal(update.rows[1].values[1].userEnteredValue.stringValue,'=Member');assert.equal(update.rows[1].values[6].userEnteredValue.numberValue,700);assert.equal(update.range.endRowIndex,1000);
});
test('mirror rejects unexpected headers and wrong-gym workbook before mutation',async()=>{
 for(const options of [{wrongHeader:true},{wrongGym:true}]){const sheets=sheetsMock(options);await assert.rejects(writeFallback({sheets,spreadsheetId:'new-fallback-workbook-id-12345',snapshot:sample()}));assert.equal(sheets.calls.length,0);}
});
test('access checks use actual active periods, not the latest future renewal alone',()=>{
 const s=sample();s.memberships.push({...s.memberships[0],id:'future',start_date:'2026-12-01',end_date:'2026-12-31'});
 assert.equal(deviceTargets(s,['m'],'2026-10-27')[0].active,true);assert.equal(deviceTargets(s,['m'],'2026-11-15')[0].active,false);assert.equal(deviceTargets(s,['m'],'2026-12-15')[0].active,true);
 s.members[0].is_archived=true;assert.equal(deviceTargets(s,['m'],'2026-10-27')[0].active,false);
});
function adapter(users=[]){const calls=[];return {calls,connect:async()=>calls.push('connect'),users:async()=>users,prepare:async()=>calls.push('prepare'),upsert:async(t,old)=>calls.push(['upsert',t,old]),access:async(uid,active)=>calls.push(['access',uid,active]),refresh:async()=>calls.push('refresh'),disconnect:async()=>calls.push('disconnect')};}
test('fingerprint uses Supabase IDs, preserves existing user credentials, and leaves unknown users alone',async()=>{
 const old={uid:661,userId:'661',name:'Typo',role:14,password:'kept',cardno:42},a=adapter([old,{uid:999,userId:'999',name:'Other'}]);
 await syncFingerprint(sample(),[{payload:{member_id:'m'}}],a);const write=a.calls.find(c=>Array.isArray(c)&&c[0]==='upsert');assert.equal(write[1].uid,661);assert.equal(write[1].userId,'661');assert.deepEqual(write[2],old);assert.equal(a.calls.filter(c=>Array.isArray(c)&&c[0]==='access').length,1);assert.equal(a.calls.at(-1),'disconnect');
});
test('UID collisions are detected before timezone/user/access mutations',async()=>{
 const a=adapter([{uid:661,userId:'999'}]);await assert.rejects(syncFingerprint(sample(),[{payload:{member_id:'m'}}],a),/conflict/);assert.deepEqual(a.calls,['connect','disconnect']);
});
test('bridge marks failed deliveries as failed and acknowledges only after external success',async()=>{
 const calls=[];let fail=true;const bridge=createSecondaryBridge({env:{FALLBACK_SPREADSHEET_ID:'new-fallback-workbook-id-12345'},sheetsClient:()=>({}),mirror:async()=>{if(fail)throw new Error('Offline');return {sheets:6};},rpc:async(name,body)=>{calls.push({name,body});if(name==='begin_secondary_sync')return {lease_id:'lease',jobs:[{id:'job'}],snapshot:sample()};return 1;}});
 await assert.rejects(bridge.run({gymId:'gym-a',token:'jwt',destination:'google_sheets'}),/Offline/);assert.equal(calls.at(-1).body.succeeded,false);
 fail=false;const r=await bridge.run({gymId:'gym-a',token:'jwt',destination:'google_sheets'});assert.equal(r.completed,1);assert.equal(calls.at(-1).body.succeeded,true);
});
test('unconfigured destinations perform no RPC or hardware operations',async()=>{
 let calls=0;const bridge=createSecondaryBridge({env:{},rpc:async()=>{calls++;}});for(const destination of ['google_sheets','fingerprint'])await assert.rejects(bridge.run({gymId:'gym-a',destination}));assert.equal(calls,0);
});
test('device access dates use India time and permit only today/tomorrow',()=>{
 const now=new Date('2026-10-27T20:00:00Z');
 assert.equal(validateAccessDate('2026-10-28',now),'2026-10-28');assert.equal(validateAccessDate('2026-10-29',now),'2026-10-29');
 for(const day of ['2026-10-27','2026-10-30','invalid'])assert.throws(()=>validateAccessDate(day,now));
});
test('explicit dated sync covers all mapped members, not only ten queued jobs, and retains its date',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tomorrow=new Date(new Date(today+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
 const s=sample();s.members.push({...s.members[0],id:'second',device_user_id:662,admission_id:'ZF-662'});
 const env={};let received;const bridge=createSecondaryBridge({env,rpc:async(name)=>name==='begin_secondary_sync'?{lease_id:'lease',snapshot:s,jobs:[{payload:{member_id:'m'}}]}:1,deviceAdapter:()=>({}),fingerprint:async(snapshot,jobs)=>{received={date:snapshot.access_date,ids:jobs.map(j=>j.payload.member_id)};return {processed:jobs.length};}});
 const result=await bridge.run({gymId:'gym-a',destination:'fingerprint',manualDate:tomorrow});
 assert.deepEqual(received,{date:tomorrow,ids:['m','second']});assert.equal(result.accessDate,tomorrow);assert.equal(env.DEVICE_ACCESS_DATE,tomorrow);
});
test('a busy lease cannot change the selected device access date',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const env={};const bridge=createSecondaryBridge({env,rpc:async()=>({busy:true})});
 assert.equal((await bridge.run({gymId:'gym-a',destination:'fingerprint',manualDate:today})).busy,true);assert.equal(env.DEVICE_ACCESS_DATE,undefined);
});
test('ID floor is displayed as 660 but higher existing IDs are never reset',()=>{
 const s=sample();s.last_admission_id=660;s.members[0].device_user_id=700;assert.equal(projectFallback(s)['System Control'][1][1],700);
});
test('portal previews and sync actions are admin-only and use the authenticated gym',async()=>{
 const express=require('express');const {createDashboardRouter}=require('./dashboardRoutes');
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
 let role='admin',writes=0;const calls=[];
 const mock=async(url,opts)=>{const u=new URL(url);calls.push({u,opts});
  if(u.pathname==='/auth/v1/token')return Response.json({access_token:'jwt',refresh_token:'refresh',expires_in:3600,user:{id:'u'}});
  if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff',gym_id:'gym-a',user_id:'u',role,is_active:true}]);
  if(u.pathname==='/rest/v1/rpc/get_fallback_snapshot')return Response.json(sample());
  if(u.pathname==='/rest/v1/rpc/begin_secondary_sync')return Response.json({lease_id:'lease',jobs:[{id:'j'}],snapshot:sample()});
  if(u.pathname==='/rest/v1/rpc/finish_secondary_sync')return Response.json(1);
  throw new Error('Unexpected upstream request');
 };
 const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock,secondaryOptions:{env:{FALLBACK_SPREADSHEET_ID:'new-fallback-workbook-id-12345'},sheetsClient:()=>({}),mirror:async()=>{writes++;return {sheets:6};}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/portal`;
 try{
  assert.equal((await fetch(base+'/secondary-sync/preview')).status,401);
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'e',password:'p'})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/secondary-sync/preview',{headers})).status,200);assert.equal(writes,0);
  assert.equal((await fetch(base+'/secondary-sync',{method:'POST',headers,body:JSON.stringify({destination:'google_sheets',gymId:'wrong'})})).status,200);assert.equal(writes,1);
  const claim=calls.find(c=>c.u.pathname.endsWith('begin_secondary_sync'));assert.equal(JSON.parse(claim.opts.body).target_gym,'gym-a');assert.equal(claim.opts.headers.Authorization,'Bearer jwt');
  for(role of ['receptionist','trainer']){assert.equal((await fetch(base+'/secondary-sync/preview',{headers})).status,403);assert.equal((await fetch(base+'/secondary-sync',{method:'POST',headers,body:JSON.stringify({destination:'google_sheets'})})).status,403);}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
