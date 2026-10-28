const byId=id=>document.getElementById(id);
let details=null, selected=null, searching=0;
const status=byId('formStatus');
function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function resetSelection(){details=null;selected=null;for(const form of document.querySelectorAll('form'))for(const el of form.elements)el.disabled=true;byId('membershipSelect').disabled=true;}
function showPeriod(){
  selected=details.periods.find(p=>p.id===byId('membershipSelect').value)||null;
  for(const id of ['newPlan','newStartDate','newEndDate','packageNote','savePackageBtn'])byId(id).disabled=!selected;
  for(const id of ['amountPaid','paymentMode','paymentNote','savePaymentBtn'])byId(id).disabled=!selected||selected.outstanding===null||selected.outstanding<=0;
  byId('currentPlan').value=selected?.plan_name||'No membership';byId('currentStartDate').value=selected?.start_date||'';byId('currentEndDate').value=selected?.end_date||'';
  byId('currentPaymentStatus').value=selected?(selected.outstanding===null?'Accounting review required':selected.outstanding>0?'Payment pending':'Paid'):'No membership';
  if(selected){const plan=details.plans.find(p=>p.id===selected.plan_id);byId('newPlan').value=plan?.code||'custom';byId('newStartDate').value=selected.start_date;byId('newEndDate').value=selected.end_date;byId('amountPaid').max=selected.outstanding??0;}
}
async function fetchMember(){
  const generation=++searching;resetSelection();byId('searchBtn').disabled=true;message('Searching Supabase...');
  try{const data=await zenithFind(byId('searchMember').value);if(generation!==searching)return;details=data;
    byId('memberName').value=data.member.full_name;byId('memberId').value=data.member.admission_id;byId('hiddenAdmissionId').value=data.member.admission_id;byId('hiddenMobile').value=data.member.phone||'';
    byId('editName').value=data.member.full_name;byId('editPhone').value=data.member.phone||'';
    for(const el of byId('profileForm').elements)el.disabled=false;
    byId('currentPendingAmount').value=data.periods.reduce((s,p)=>s+(p.outstanding||0),0);
    const select=byId('membershipSelect');select.replaceChildren();for(const p of data.periods){const option=new Option(p.plan_name+' | '+p.start_date+' to '+p.end_date+' | '+(p.outstanding===null?'Needs accounting review':'INR '+p.outstanding+' due'),p.id);select.add(option);}select.disabled=!data.periods.length;showPeriod();
    message('Member loaded.'+(data.periods.some(p=>p.outstanding===null)?' Some historical balances need accounting review before collection.':''));
  }catch(e){message(e.message,true);}finally{if(generation===searching)byId('searchBtn').disabled=false;}
}
function calculatePackageEndDate(){if(byId('newPlan').value==='custom'||!byId('newStartDate').value)return;const d=new Date(byId('newStartDate').value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(byId('newPlan').value));byId('newEndDate').value=d.toISOString().slice(0,10);}
let saving=false;
async function save(form,command,payload){if(saving)return;saving=true;const button=form.querySelector('button');button.disabled=true;message('Saving to Supabase...');
  try{await zenithCommand(command,{member_id:details.member.id,...payload});form.reset();await fetchMember();message('Saved to Supabase. Dashboard updated. Secondary sync queued.');}
  catch(e){message(e.message,true);}finally{saving=false;button.disabled=!details||(command==='payment'&&(!selected||selected.outstanding===null||selected.outstanding<=0));}}
byId('profileForm').addEventListener('submit',e=>{e.preventDefault();if(!details)return;save(e.target,'profile',{full_name:byId('editName').value.trim(),phone:byId('editPhone').value.replace(/\D/g,''),reason:byId('profileNote').value.trim(),expected_name:details.member.full_name,expected_phone:details.member.phone});});
byId('paymentForm').addEventListener('submit',e=>{e.preventDefault();if(!selected)return;save(e.target,'payment',{membership_id:selected.id,amount:byId('amountPaid').value,payment_mode:byId('paymentMode').value,reason:byId('paymentNote').value});});
byId('packageForm').addEventListener('submit',e=>{e.preventDefault();if(!selected)return;const plan=details.plans.find(p=>p.code===byId('newPlan').value&&p.is_active);if(!plan)return message('Choose an active package.',true);save(e.target,'membership',{membership_id:selected.id,plan_id:plan.id,start_date:byId('newStartDate').value,end_date:byId('newEndDate').value,reason:byId('packageNote').value.trim(),expected_start:selected.start_date,expected_end:selected.end_date,expected_plan:selected.plan_id});});
byId('searchBtn').addEventListener('click',()=>{if(!saving)fetchMember();});byId('searchMember').addEventListener('keydown',e=>{if(e.key==='Enter'&&!saving){e.preventDefault();fetchMember();}});
byId('membershipSelect').addEventListener('change',showPeriod);byId('newPlan').addEventListener('change',calculatePackageEndDate);byId('newStartDate').addEventListener('change',calculatePackageEndDate);
resetSelection();
const initialMember=new URLSearchParams(location.search).get('member');if(initialMember){byId('searchMember').value=initialMember;fetchMember();}
