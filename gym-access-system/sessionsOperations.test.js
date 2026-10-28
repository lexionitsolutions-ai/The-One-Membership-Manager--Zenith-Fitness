const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const {PersistentSessions}=require('./persistentSessions');const {createDashboardRouter}=require('./dashboardRoutes');const {privateNetwork}=require('./openOperations');
async function serve(options){const app=express();app.use(express.json());app.use(createDashboardRouter(options));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return {base:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};}
test('encrypted dashboard sessions survive restarts, ignore former fixed expiry, and logout removes the saved session',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zenith-session-test-'));
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
 const mock=async(url)=>new URL(url).pathname==='/auth/v1/token'?Response.json({access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600,user:{id:'u'}}):Response.json([{id:'staff',user_id:'u',gym_id:'gym',role:'admin',is_active:true}]);
 let server=await serve({fetchImpl:mock,sessionStore:new PersistentSessions(directory)});
 try{
  const login=await fetch(server.base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'test-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(!fs.readFileSync(path.join(directory,'sessions.encrypted')).includes(Buffer.from('private-refresh-token')));
  await server.close();const store=new PersistentSessions(directory);const id=cookie.split('=')[1];store.set(id,{...store.get(id),deadline:1});
  server=await serve({fetchImpl:mock,sessionStore:store});assert.equal((await fetch(server.base+'/session',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(server.base+'/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,200);
  assert.equal(new PersistentSessions(directory).size,0);assert.equal((await fetch(server.base+'/session',{headers:{Cookie:cookie}})).status,401);
 }finally{await server.close();for(const file of ['session.key','sessions.encrypted']){const target=path.join(directory,file);if(fs.existsSync(target))fs.unlinkSync(target);}fs.rmdirSync(directory);}
});
test('direct local forms use an isolated machine identity; dashboard and staff management stay authenticated',async()=>{
 const previous=Object.fromEntries(['OPEN_OPERATIONS_ENABLED','OPEN_OPERATIONS_GYM_ID','SUPABASE_SECRET_KEY'].map(k=>[k,process.env[k]]));
 process.env.OPEN_OPERATIONS_ENABLED='1';process.env.OPEN_OPERATIONS_GYM_ID='configured-gym';process.env.SUPABASE_SECRET_KEY='test-secret';
 let accountCount=0,saved,machineAssigned=false;
 const mock=async(url,opts)=>{const p=new URL(url).pathname;
  if(p==='/auth/v1/admin/users'){accountCount++;const body=JSON.parse(opts.body);assert.equal(body.app_metadata.zenith_staff.gym_id,'configured-gym');return Response.json({id:'machine-user'});}
  if(p==='/auth/v1/token')return Response.json({access_token:'machine-jwt',refresh_token:'r',expires_in:3600,user:{id:'machine-user'}});
  if(p==='/rest/v1/staff'){
   if(opts.headers.apikey==='test-secret'){
    if(opts.method==='POST'){const assigned=JSON.parse(opts.body);assert.equal(assigned.user_id,'machine-user');assert.equal(assigned.gym_id,'configured-gym');machineAssigned=true;return Response.json(null,{status:201});}
    return Response.json(machineAssigned?[{id:'machine-staff',role:'admin',is_active:true}]:[]);
   }
   return Response.json([{id:'machine-staff',user_id:'machine-user',role:'admin',gym_id:'configured-gym',is_active:true}]);
  }
  if(p==='/rest/v1/rpc/submit_enquiry'){saved=JSON.parse(opts.body);return Response.json({success:true,enquiryId:'lead'});}
  if(p==='/rest/v1/rpc/begin_secondary_sync')return Response.json({busy:true});
  throw new Error('Unexpected '+p);
 };
 const server=await serve({fetchImpl:mock,operationStore:new Map(),secondaryOptions:{env:{}}});
 try{
  assert.equal((await fetch(server.base+'/operations-session')).status,200);assert.equal(machineAssigned,true);
  const result=await fetch(server.base+'/form-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enquire',name:'Test Lead',contact:'9000000000',requestId:'fa000000-0000-4000-8000-000000000141',gym_id:'forged'})});
  assert.equal(result.status,200);assert.equal(saved.target_gym,'configured-gym');assert.equal(accountCount,1);
  assert.equal((await fetch(server.base+'/dashboard')).status,401);assert.equal((await fetch(server.base+'/session')).status,401);
  assert.equal((await fetch(server.base+'/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const tomorrow=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const sync=await fetch(server.base+'/fingerprint-date-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:tomorrow})});assert.equal(sync.status,200);assert.equal((await sync.json()).busy,true);
  assert.equal((await fetch(server.base+'/operations-session',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal(privateNetwork({socket:{remoteAddress:'203.0.113.10'}}),false);assert.equal(privateNetwork({socket:{remoteAddress:'::ffff:192.168.1.3'}}),true);
 }finally{await server.close();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
