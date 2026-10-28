const el=id=>document.getElementById(id);let member=null,trainersReady=false,busy=false,finding=false;
function ptStatus(text,error=false){el('formStatus').textContent=text;el('formStatus').classList.toggle('error',error);}
async function loadTrainers(){try{const trainers=await zenithRequest('pt-trainers');for(const t of trainers)el('trainer').add(new Option(t.name,t.id));trainersReady=trainers.length>0;if(!trainersReady)ptStatus('No active PT trainers are configured.',true);}catch(e){ptStatus(e.message,true);}}
async function findPTMember(){if(busy||finding)return;finding=true;member=null;el('ptFields').disabled=true;el('searchBtn').disabled=true;el('memberResult').textContent='Searching…';
  try{const data=await zenithFind(el('searchMember').value);member=data.member;el('memberResult').textContent=member.full_name+' · '+member.admission_id+' · '+(member.phone||'No phone');if(!trainersReady)await loadTrainers();el('ptFields').disabled=!trainersReady;}
  catch(e){el('memberResult').textContent='';ptStatus(e.message,true);}finally{finding=false;el('searchBtn').disabled=false;}}
function updatePTDates(){if(el('ptStart').value&&['1','2','3'].includes(el('ptPlan').value)){el('ptEnd').value=zenithMonthEnd(el('ptStart').value,el('ptPlan').value);el('ptEnd').readOnly=true;}else el('ptEnd').readOnly=false;}
function updatePTBalance(){const charge=Number(el('ptCharge').value)||0,paid=Number(el('ptPaid').value)||0;el('ptBalance').textContent='Pending: ₹ '+(charge-paid).toLocaleString('en-IN',{maximumFractionDigits:2});el('ptPaid').max=charge;el('ptMode').required=paid>0;}
el('searchBtn').addEventListener('click',findPTMember);el('searchMember').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findPTMember();}});
el('ptPlan').addEventListener('change',updatePTDates);el('ptStart').addEventListener('change',updatePTDates);el('ptCharge').addEventListener('input',updatePTBalance);el('ptPaid').addEventListener('input',updatePTBalance);
el('ptForm').addEventListener('submit',async e=>{e.preventDefault();if(!member||busy)return;
  const payload={member_id:member.id,trainer_id:el('trainer').value,package:el('ptPlan').value,start_date:el('ptStart').value,end_date:el('ptEnd').value,total_amount:el('ptCharge').value,paid_amount:el('ptPaid').value,payment_mode:el('ptMode').value,notes:el('ptNotes').value};
  if(payload.end_date<payload.start_date)return ptStatus('End date must be on or after start date.',true);
  busy=true;el('savePT').disabled=true;ptStatus('Saving personal training…');
  try{await window.ZenithMessages.refresh().catch(()=>{});await zenithCommand('pt',payload);
    const message=window.ZenithMessages.render('pt',{member_name:member.full_name,admission_id:member.admission_id,phone:member.phone,plan:payload.package==='custom'?'Custom PT':payload.package+' Month(s)',trainer_name:Array.from(el('trainer').options).find(o=>o.value===payload.trainer_id)?.text,start_date:payload.start_date,end_date:payload.end_date,amount_paid:payload.paid_amount,pending_amount:(Number(payload.total_amount)-Number(payload.paid_amount)).toFixed(2)});
    const url=window.ZenithMessages.url(member.phone,message);el('ptForm').reset();updatePTBalance();el('ptEnd').readOnly=false;ptStatus('Personal training saved to Supabase. Open Personal Training in the dashboard to see the record.');
    if(url&&confirm('PT saved. Open the WhatsApp confirmation message?'))window.open(url,'_blank','noopener,noreferrer');}
  catch(error){ptStatus(error.message,true);}finally{busy=false;el('savePT').disabled=false;}
});
