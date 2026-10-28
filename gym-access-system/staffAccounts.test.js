const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {createDashboardRouter}=require('./dashboardRoutes');
test('staff creation is admin-only, scoped to the session gym, and never returns credentials',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='publishable';
 const previous=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='test-server-secret';
 let role='admin',created,adminCalls=0,duplicate=false,linkedRole;
 const mock=async(url,opts)=>{const p=new URL(url).pathname;
  if(p==='/auth/v1/token')return Response.json({access_token:'user-jwt',refresh_token:'r',expires_in:3600,user:{id:'actor'}});
  if(p==='/rest/v1/staff'){
   if(opts.headers.apikey==='test-server-secret'){
    if(opts.method==='POST'){const body=JSON.parse(opts.body);assert.equal(body.gym_id,'session-gym');assert.equal(body.user_id,'created-user');linkedRole=body.role;return Response.json(null,{status:201});}
    return Response.json(linkedRole?[{id:'new-staff',role:linkedRole,is_active:true}]:[]);
   }
   return Response.json([{id:'actor-staff',gym_id:'session-gym',user_id:'actor',role,is_active:true}]);
  }
  if(p==='/rest/v1/rpc/staff_account_setup_ready'){assert.equal(JSON.parse(opts.body).target_gym,'session-gym');assert.equal(opts.headers.Authorization,'Bearer user-jwt');return Response.json(true);}
  if(p==='/auth/v1/admin/users'){adminCalls++;assert.equal(opts.headers.apikey,'test-server-secret');created=JSON.parse(opts.body);
   return duplicate?Response.json({code:'email_exists',msg:'already exists'},{status:422}):Response.json({id:'created-user',email:created.email});}
  throw new Error('Unexpected endpoint '+p);
 };
 const app=express();app.use(express.json());app.use(createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'example-test-password'})});
  const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};
  const body={full_name:'New Trainer',role:'trainer',login:'9876543210',password:'example-new-password',gym_id:'forged'};
  const post=()=>fetch(base+'/staff',{method:'POST',headers,body:JSON.stringify(body)});
  const result=await post();assert.equal(result.status,201);const resultBody=await result.text();assert.ok(!resultBody.includes(body.password));assert.ok(!resultBody.includes('test-server-secret'));
  assert.equal(created.email,'9876543210@staff.zenith.local');assert.equal(created.password,body.password);assert.equal(created.email_confirm,true);assert.equal(linkedRole,'trainer');
  assert.deepEqual(created.app_metadata.zenith_staff,{gym_id:'session-gym',full_name:'New Trainer',role:'trainer'});
  body.login='trainer@example.com';assert.equal((await post()).status,201);assert.equal(created.email,'trainer@example.com');
  duplicate=true;assert.equal((await post()).status,409);
  const before=adminCalls;role='receptionist';assert.equal((await post()).status,403);role='trainer';assert.equal((await post()).status,403);assert.equal(adminCalls,before);
  role='admin';body.password='short';assert.equal((await post()).status,400);assert.equal(adminCalls,before);
  body.password='example-new-password';delete process.env.SUPABASE_SECRET_KEY;const oldService=process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{assert.equal((await post()).status,503);assert.equal(adminCalls,before);}finally{if(oldService!==undefined)process.env.SUPABASE_SERVICE_ROLE_KEY=oldService;}
 }finally{if(previous===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
