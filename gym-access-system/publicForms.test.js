const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {createDashboardRouter}=require('./dashboardRoutes');const messages=require('./public/dashboard/whatsapp-templates');
test('four public forms work without a session while member edits, reports and device sync remain protected',async()=>{
 const values={VERCEL:'1',OPEN_OPERATIONS_ENABLED:'1',OPEN_OPERATIONS_GYM_ID:'gym',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'};
 const saved=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);const calls=[];
 const mock=async(url,opts)=>{const u=new URL(url);calls.push(u.pathname);
  if(u.pathname==='/rest/v1/staff')return Response.json([{id:'operator-staff',user_id:'operator-user',gym_id:'gym',role:'admin',is_active:true}]);
  if(u.pathname==='/rest/v1/members')return Response.json([{id:'m',admission_id:'ZF-1',full_name:'Example Member',phone:'9000000000'}]);
  if(u.pathname==='/rest/v1/memberships')return Response.json([]);
  if(u.pathname==='/rest/v1/pt_trainers')return Response.json([{id:'trainer',name:'Arif'}]);
  if(u.pathname==='/rest/v1/whatsapp_templates')return Response.json(messages.specs);
  if(u.pathname==='/rest/v1/rpc/manage_member_form'){const body=JSON.parse(opts.body);assert.equal(body.command,'pt');assert.equal(body.target_gym,'gym');return Response.json({success:true,ptId:'pt'});}
  if(u.pathname==='/rest/v1/rpc/submit_enquiry')return Response.json({success:true,enquiryId:'lead'});
  throw Error('Unexpected endpoint '+u.pathname);
 };
 const machine={created:true,provisioned:true,gymId:'gym',accessToken:'machine-jwt',userId:'operator-user',expiresAt:Date.now()+3600000};
 const app=express();app.use(express.json());app.use(createDashboardRouter({fetchImpl:mock,operationStore:new Map([['machine',machine]])}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const headers={'Content-Type':'application/json'},requestId='fa000000-0000-4000-8000-000000000161';
 const post=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 try{
  for(const path of ['/pt-trainers','/member-lookup?admissionId=ZF-1','/pt-member-lookup?admissionId=ZF-1'])assert.equal((await fetch(base+path)).status,200,path);
  const ptMember=await(await fetch(base+'/pt-member-lookup?admissionId=ZF-1')).json();assert.ok(ptMember.member);assert.equal(ptMember.periods,undefined);assert.equal(ptMember.payments,undefined);
  assert.equal((await post('/member-command',{command:'pt',requestId,payload:{member_id:'m'}})).status,200);
  for(const command of ['profile','membership','payment','pt_payment'])assert.equal((await post('/member-command',{command,requestId,payload:{member_id:'m'}})).status,401,command);
  assert.equal((await post('/form-submit',{action:'enquire',requestId,name:'Example',contact:'9000000000'})).status,200);
  for(const action of ['admission','saveRenewal'])assert.equal((await post('/form-submit',{action,requestId})).status,400,'public form validation runs without login');
  const publicMessages=await(await fetch(base+'/whatsapp-templates')).json();assert.equal(publicMessages.templates.length,4);assert.ok(publicMessages.templates.every(t=>['admission','renewed','enquiry','pt'].includes(t.template_key)));
  for(const path of ['/session','/dashboard','/member-details?admissionId=ZF-1','/secondary-sync/preview'])assert.equal((await fetch(base+path)).status,401,path);
  assert.equal((await post('/fingerprint-date-sync',{date:'2026-10-28'})).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
