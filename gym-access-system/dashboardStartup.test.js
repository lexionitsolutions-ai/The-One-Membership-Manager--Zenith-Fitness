const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('startup waits for the authenticated dashboard without flashing login or requesting session twice',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'public/dashboard/index.html'),'utf8');
 assert.match(html,/<section[^>]+id="loginScreen" hidden>/);
 for(const status of [200,401,503]){
  const elements=new Map(),requests=[];
  const element=selector=>{
   if(!elements.has(selector))elements.set(selector,{hidden:['#loginScreen','#workspace'].includes(selector),innerHTML:'',value:'',open:false,addEventListener(){},setAttribute(){},classList:{add(){},remove(){}}});
   return elements.get(selector);
  };
  let finish;
  const context=vm.createContext({Intl,Date,URLSearchParams,location:{search:'',pathname:'/dashboard/'},
   document:{querySelector:element,addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{},
   parametersQuery:()=>'',setInterval(){},setTimeout,clearTimeout,
   fetch:async url=>{requests.push(url);return new Promise(resolve=>{finish=()=>resolve(Response.json(status===200?{role:'receptionist',metrics:{totalMembers:0},currentStaff:{full_name:'Reception'}}:{error:'Unavailable'},{status}));});}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'public/dashboard/app.js'),'utf8'),context);
  assert.equal(element('#loginScreen').hidden,true);
  assert.equal(element('#workspace').hidden,true);
  assert.equal(requests.length,1);
  assert.ok(requests[0].startsWith('/api/portal/dashboard?'));
  // Rendering is covered by dashboard.test.js; isolate the startup transitions here.
  vm.runInContext('renderPage=()=>{}',context);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('#startupScreen').hidden,true);
  assert.equal(element('#loginScreen').hidden,status!==401);
  assert.equal(element('#workspace').hidden,status===401);
  if(status===200)assert.equal(element('#userRole').textContent,'Receptionist');
  if(status===503)assert.equal(element('#errorBanner').hidden,false);
 }
});

