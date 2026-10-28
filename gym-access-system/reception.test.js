const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {demoDashboard}=require('./dashboardDemo');const {createDashboardRouter}=require('./dashboardRoutes');
const {resolveStaffLogin}=require('./staffLogin');
test('contact aliases preserve email logins and require the existing admin account configuration',()=>{
 const env={SUPABASE_ADMIN_LOGIN_EMAIL:'existing-admin@example.com'};
 for(const number of ['8999699811','+91 89996 99811','918999699811'])assert.equal(resolveStaffLogin(number,env),'existing-admin@example.com');
 for(const number of ['7875692761','+91 78756 92761'])assert.equal(resolveStaffLogin(number,env),'7875692761@staff.zenith.local');
 assert.equal(resolveStaffLogin('existing-admin@example.com',env),'existing-admin@example.com');
 assert.throws(()=>resolveStaffLogin('8999699811',{}),e=>e.status===503);
});
test('admin contact login submits the unchanged password to the existing Auth account',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
 const previous=process.env.SUPABASE_ADMIN_LOGIN_EMAIL;process.env.SUPABASE_ADMIN_LOGIN_EMAIL='existing-admin@example.com';let authBody;
 const mock=async(url,opts)=>new URL(url).pathname==='/auth/v1/token'
  ? (authBody=JSON.parse(opts.body),Response.json({access_token:'jwt',refresh_token:'r',expires_in:3600,user:{id:'admin-user'}}))
  : Response.json([{id:'staff',gym_id:'real-gym',role:'admin',user_id:'admin-user',is_active:true}]);
 const app=express();app.use(express.json());app.use(createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'8999699811',password:'unchanged-test-password'})});
  assert.equal(response.status,200);assert.deepEqual(authBody,{email:'existing-admin@example.com',password:'unchanged-test-password'});assert.equal((await response.json()).staff.role,'admin');
 }finally{if(previous===undefined)delete process.env.SUPABASE_ADMIN_LOGIN_EMAIL;else process.env.SUPABASE_ADMIN_LOGIN_EMAIL=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('reception responses retain operational balances but exclude payment registers and monthly sales',()=>{
 const d=demoDashboard('receptionist');for(const key of ['payments','allPayments','monthlySales','staff','auditLogs','syncJobs'])assert.equal(d[key],undefined,key);
 for(const key of ['revenue','previousRevenue','revenueChange'])assert.equal(d.metrics[key],undefined,key);
 assert.equal(d.gymOverview.totalCollected,undefined);assert.ok(d.series.every(p=>!('revenue' in p)));assert.ok(Array.isArray(d.expenses));assert.ok(d.balances.length>0);assert.ok(d.metrics.pending>0);
});
test('numeric staff username uses the internal Auth alias; reception can add expenses but cannot void',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';let authBody,expenseBody;
 const mock=async(url,opts)=>{const u=new URL(url);
  if(u.pathname==='/auth/v1/token'){authBody=JSON.parse(opts.body);return Response.json({access_token:'jwt',refresh_token:'r',expires_in:3600,user:{id:'u'}});}
  if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff',gym_id:'real-gym',role:'receptionist',user_id:'u',full_name:'Zenith Reception',is_active:true}]);
  if(u.pathname==='/rest/v1/expenses'&&opts.method==='POST'){expenseBody=JSON.parse(opts.body);return Response.json([{id:'expense',...expenseBody}]);}
  return Response.json([]);
 };
 const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/portal`;
 try{const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'7875692761',password:'example-test-password'})});assert.equal(login.status,200);assert.equal(authBody.email,'7875692761@staff.zenith.local');assert.equal(authBody.password,'example-test-password');
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/expenses',{method:'POST',headers,body:JSON.stringify({expense_date:'2026-10-28',category:'Utilities',description:'Test receipt',amount:100,payment_mode:'Cash',gym_id:'forged',created_by:'forged'})})).status,200);
  assert.equal(expenseBody.gym_id,'real-gym');assert.equal(expenseBody.created_by,'staff');assert.equal(expenseBody.amount,100);
  assert.equal((await fetch(base+'/expenses/fa000000-0000-4000-8000-000000000099',{method:'DELETE',headers,body:'{}'})).status,403);
  const dashboard=await(await fetch(base+'/dashboard',{headers})).json();assert.equal(dashboard.role,'receptionist');assert.equal(dashboard.allPayments,undefined);assert.equal(dashboard.monthlySales,undefined);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
