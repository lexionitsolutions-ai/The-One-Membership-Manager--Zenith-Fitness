const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const messages=require('./public/dashboard/whatsapp-templates');const {createDashboardRouter}=require('./dashboardRoutes');const {projectFallback}=require('./fallbackProjection');
test('central messages cover every workflow and safely render placeholders once',()=>{
 assert.deepEqual(messages.specs.map(s=>s.template_key),['admission','renewal_reminder','renewed','pt','enquiry','followup','pending','member_review']);
 const body=messages.render('admission',{member_name:'{{gym_phone}}',admission_id:'ZF-661'},[{template_key:'admission',body:'Hello {{member_name}} / {{admission_id}} / {{gym_name}}'}]);
 assert.equal(body,'Hello {{gym_phone}} / ZF-661 / Zenith Fitness');assert.throws(()=>messages.render('unknown'));
 const url=new URL(messages.url('9876543210','Hello & welcome\nMember'));assert.equal(url.pathname,'/919876543210');assert.equal(url.searchParams.get('text'),'Hello & welcome\nMember');
 for(const spec of messages.specs){for(const match of spec.body.matchAll(/\{\{([a-z_]+)\}\}/g))assert.ok(spec.variables.includes(match[1]),spec.template_key+' '+match[1]);}
});
test('approved messages match canonical seeds, preserve emojis and use day-month-year dates everywhere',()=>{
 const seeds=require('../scripts/whatsapp-template-seeds.json');
 for(const key of ['admission','renewed','enquiry','renewal_reminder']){
  const body=messages.specs.find(s=>s.template_key===key).body;assert.equal(body,seeds.find(s=>s.template_key===key).body);assert.ok(!body.includes('\uFFFD'));
  const rendered=messages.render(key,{member_name:'Example Member',admission_id:'ZF-661',plan:'Customize Package',start_date:'2026-10-28',end_date:'2027-05-27'});
  assert.ok(!/\{\{[a-z_]+\}\}/.test(rendered));if(key!=='enquiry')assert.ok(rendered.includes('27-05-2027'));
  assert.equal(new URL(messages.url('9876543210',rendered)).searchParams.get('text'),rendered);
 }
 assert.ok(messages.render('renewal_reminder',{member_name:'Example',end_date:'2026-10-22'}).includes('UPI / GPay on'));
 assert.ok(messages.render('renewed').includes('https://g.page/r/CTR-7sBIfPWYEBM/review'));
 assert.ok(messages.render('enquiry').includes('1 Year \u2013 Rs. 9991'));
});
test('fallback WhatsApp cells use the saved admin template',()=>{
 const p=projectFallback({gym_id:'test',generated_at:'2026-10-27',members:[{id:'m',full_name:'Member',admission_id:'ZF-661',device_user_id:661,phone:'9876543210'}],memberships:[{id:'period',member_id:'m',plan_id:'p',status:'confirmed',kind:'admission',start_date:'2026-10-27',end_date:'2026-11-26',final_amount:100,accounting_verified:true}],payments:[],plans:[],whatsapp_templates:[{template_key:'admission',body:'Custom welcome {{member_name}} ({{admission_id}})'}]});
 assert.equal(p.Admissions[1][10],'Custom welcome Member (ZF-661)');assert.equal(new URL(p.Admissions[1][11]).searchParams.get('text'),p.Admissions[1][10]);
});
test('admin can save templates; reception can read; trainers cannot read or edit',async()=>{
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';let role='admin';const calls=[];
 const row={...messages.specs[0],updated_at:'2026-10-27T00:00:00Z'};
 const mock=async(url,opts)=>{const u=new URL(url);calls.push({u,opts});
  if(u.pathname==='/auth/v1/token')return Response.json({access_token:'jwt',refresh_token:'refresh',expires_in:3600,user:{id:'u'}});
  if(u.pathname==='/rest/v1/staff')return Response.json([{id:'staff',gym_id:'real-gym',user_id:'u',role,is_active:true}]);
  if(u.pathname==='/rest/v1/whatsapp_templates')return Response.json([row]);
  if(u.pathname==='/rest/v1/rpc/save_whatsapp_template')return Response.json({...row,body:JSON.parse(opts.body).new_body});
  throw new Error('Unexpected request');
 };
 const app=express();app.use(express.json());app.use('/api/portal',createDashboardRouter({fetchImpl:mock}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/portal`;
 try{assert.equal((await fetch(base+'/whatsapp-templates')).status,401);
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'test'})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/whatsapp-templates',{headers})).status,200);
  const body={body:'Welcome {{member_name}}',expected_updated_at:row.updated_at,gym_id:'forged'};
  assert.equal((await fetch(base+'/whatsapp-templates/admission',{method:'PUT',headers,body:JSON.stringify(body)})).status,200);
  const rpc=JSON.parse(calls.at(-1).opts.body);assert.equal(rpc.target_gym,'real-gym');assert.equal(rpc.new_body,body.body);assert.equal(rpc.expected_updated_at,row.updated_at);
  assert.equal((await fetch(base+'/whatsapp-templates/unknown',{method:'PUT',headers,body:JSON.stringify(body)})).status,400);
  role='receptionist';assert.equal((await fetch(base+'/whatsapp-templates',{headers})).status,200);assert.equal((await fetch(base+'/whatsapp-templates/admission',{method:'PUT',headers,body:JSON.stringify(body)})).status,403);
  role='trainer';assert.equal((await fetch(base+'/whatsapp-templates',{headers})).status,403);assert.equal((await fetch(base+'/whatsapp-templates/admission',{method:'PUT',headers,body:JSON.stringify(body)})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
