const {test}=require('node:test');const assert=require('node:assert/strict');
const {CloudRuntimeStore}=require('./cloudRuntime');const {createCloudBridge}=require('./cloudBridge');const {accessToken,validToken,hasFormsAccess}=require('./formsAccess');const {awaitBridge}=require('./public/dashboard/portal-jobs');
function fixture(){const rows=new Map();const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'secret',PORTAL_SESSION_SECRET:'a'.repeat(64)};
 const fetchImpl=async(url,opts)=>{const u=new URL(url),b=opts.body?JSON.parse(opts.body):null,key=u.searchParams.get('key')?.slice(3);
  if(u.pathname.endsWith('claim_portal_runtime_lock')){const row=rows.get(b.entry_key);if(!row||row.lock_token)return Response.json(false);row.lock_token=b.lease_token;return Response.json(true);}
  if(opts.method==='POST'){if(!opts.headers.Prefer?.includes('ignore-duplicates')||!rows.has(b.key))rows.set(b.key,{...rows.get(b.key),...b});return new Response(null,{status:201});}
  if(opts.method==='DELETE'){rows.delete(key);return new Response(null,{status:204});}
  if(opts.method==='PATCH'){const row=rows.get(key);if(!row||row.lock_token!==u.searchParams.get('lock_token')?.slice(3))return Response.json([]);Object.assign(row,b);return opts.headers.Prefer?Response.json([row]):new Response(null,{status:204});}
  return Response.json(rows.has(key)?[rows.get(key)]:[]);
 };return {rows,env,fetchImpl};}
test('cloud runtime survives separate instances, encrypts tokens, isolates namespaces and deletes sessions on logout',async()=>{
 const f=fixture(),a=new CloudRuntimeStore('sessions',f),b=new CloudRuntimeStore('sessions',f);await a.set('session-id',{refreshToken:'private-token',userId:'u',expiresAt:1});
 assert.equal((await b.get('session-id')).refreshToken,'private-token');assert.ok(!JSON.stringify([...f.rows]).includes('private-token'));
 const stored=[...f.rows.values()][0].encrypted_value;assert.throws(()=>new CloudRuntimeStore('other',f).decode('session-id',stored));
 await b.delete('session-id');assert.equal(await a.get('session-id'),undefined);
 const op=new CloudRuntimeStore('operations',f);const values=await Promise.all([op.ensure('machine',()=>({password:'first'})),op.ensure('machine',()=>({password:'second'}))]);assert.equal(values[0].password,values[1].password);
});
test('cloud session refresh is serialized across function instances',async()=>{
 const f=fixture(),a=new CloudRuntimeStore('sessions',f),b=new CloudRuntimeStore('sessions',f);await a.set('s',{refreshToken:'old',expiresAt:1});let count=0;
 const refresh=async value=>{count++;await new Promise(r=>setTimeout(r,20));return {...value,refreshToken:'new',expiresAt:Date.now()+3600000};};
 const result=await Promise.all([a.refresh('s',refresh),b.refresh('s',refresh)]);assert.equal(count,1);assert.ok(result.every(x=>x.refreshToken==='new'));
});
test('private staff links are gym-scoped, tamper resistant, and never grant a dashboard session',()=>{
 const env={PORTAL_SESSION_SECRET:'b'.repeat(64),OPEN_OPERATIONS_GYM_ID:'gym'};const token=accessToken(env);
 assert.equal(validToken(token,env),true);assert.equal(validToken(token+'x',env),false);assert.equal(validToken(token,{...env,OPEN_OPERATIONS_GYM_ID:'other'}),false);
 assert.equal(hasFormsAccess({headers:{cookie:'zenith_forms_access='+token}},env),true);assert.equal(hasFormsAccess({headers:{cookie:'zenith_staff_session='+token}},env),false);
});
test('cloud bridge refuses offline jobs and scopes queued jobs to the authorized gym and actor',async()=>{
 let online=false,body;
 const bridge=createCloudBridge({env:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'secret'},fetchImpl:async(url,opts)=>{
  const u=new URL(url);if(u.pathname.endsWith('bridge_status'))return Response.json(online?[{last_seen:new Date().toISOString()}]:[]);
  if(u.pathname.endsWith('enqueue_bridge_request')){body=JSON.parse(opts.body);return Response.json('job-id');}
  throw Error('Unexpected request');
 }});
 await assert.rejects(bridge.enqueue('gym','actor','attendance_refresh',{}),/offline/);online=true;
 assert.equal((await bridge.enqueue('gym','actor','fingerprint_date_sync',{date:'2026-10-28'})).queued,true);assert.equal(body.target_gym,'gym');assert.equal(body.actor,'actor');
});
test('cloud job polling reports success only after completion and propagates failures',async()=>{
 let count=0;const result=await awaitBridge('job',{sleep:async()=>{},fetchImpl:async()=>Response.json(++count===1?{status:'processing'}:{status:'completed',result:{success:true,processed:10}})});assert.equal(result.processed,10);assert.equal(count,2);
 await assert.rejects(awaitBridge('job',{fetchImpl:async()=>Response.json({status:'failed',error:'Device unreachable'})}),/Device unreachable/);
});
