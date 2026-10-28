const {collectionChannel}=require('./reporting');
const {reservedDevices,isReservedMember}=require('./reservedDeviceIds');
const messages=require('./public/dashboard/whatsapp-templates');
const MEMBERSHIP_HEADERS=['ID','NAME','CNUMBER','PLAN','START DATE','END DATE','AMOUNT PAID','PENDING AMOUNT','PAYMENT MODE','PAYMENT STATUS','WHATSAPP MESSAGE','LINK'];
const HEADERS={Admissions:MEMBERSHIP_HEADERS,Renewals:MEMBERSHIP_HEADERS,Database:['ID','NAME','END DATE'],'System Control':['SETTING','VALUE'],'Daily Cash Book':['DATE','DESCRIPTION','TRANSACTION TYPE','AMOUNT','PAYMENT MODE'],'Renewal List':['ID','NAME','END DATE']};
const indiaDay=value=>value?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
function whatsapp(phone,message){let digits=String(phone||'').replace(/\D/g,'');if(digits.length===10)digits='91'+digits;return /^[1-9]\d{10,14}$/.test(digits)?`https://wa.me/${digits}?text=${encodeURIComponent(message)}`:'';}
function projectFallback(s){
  if(!s?.gym_id||!Array.isArray(s.members)||!Array.isArray(s.memberships)||!Array.isArray(s.payments))throw new Error('Incomplete Supabase snapshot; fallback was not changed.');
  const members=new Map(s.members.map(m=>[m.id,m])),plans=new Map((s.plans||[]).map(p=>[p.id,p]));
  const reserved=reservedDevices(s);
  const paymentsByPeriod=new Map();for(const p of s.payments){const list=paymentsByPeriod.get(p.membership_id)||[];list.push(p);paymentsByPeriod.set(p.membership_id,list);}
  const result=Object.fromEntries(Object.entries(HEADERS).map(([k,v])=>[k,[v]]));const latest=new Map();
  const sorted=[...s.memberships].sort((a,b)=>(a.purchased_at||a.start_date).localeCompare(b.purchased_at||b.start_date)||a.id.localeCompare(b.id));
  for(const p of sorted){
    if(p.status!=='confirmed')continue;
    const m=members.get(p.member_id);if(!m)throw new Error('Membership has no member mapping.');
    if(!latest.has(m.id)||p.end_date>latest.get(m.id).end_date)latest.set(m.id,p);
    const ledger=paymentsByPeriod.get(p.id)||[];
    const paid=Number(p.opening_paid_amount||0)+ledger.reduce((n,x)=>n+Number(x.amount)*(x.kind==='refund'?-1:1),0);
    const charge=p.final_amount??p.historical_charge;
    const verified=p.accounting_verified!==false&&charge!==null&&charge!==undefined;
    const due=verified?Math.max(0,Number(charge)-paid):'';
    const cash=ledger.filter(x=>collectionChannel(x.payment_mode)==='cash').reduce((n,x)=>n+Number(x.amount)*(x.kind==='refund'?-1:1),0);
    const online=ledger.filter(x=>collectionChannel(x.payment_mode)==='online').reduce((n,x)=>n+Number(x.amount)*(x.kind==='refund'?-1:1),0);
    const modes=[...new Set(ledger.map(x=>x.payment_mode))];
    let mode=cash>0&&online>0?`Cash ${cash.toFixed(2)} + Online ${online.toFixed(2)}`:modes.join(' + ');
    if(Number(p.opening_paid_amount)>0)mode+=(mode?' + ':'')+'Historical opening (mode unverified)';
    const message=messages.render(p.kind==='renewal'?'renewed':'admission',{member_name:m.full_name,admission_id:m.admission_id,phone:m.phone,plan:plans.get(p.plan_id)?.name||'Custom',start_date:p.start_date,end_date:p.end_date,amount_paid:verified?paid:'Needs review',pending_amount:due},s.whatsapp_templates||[]);
    const row=[m.admission_id,m.full_name,m.phone||'',plans.get(p.plan_id)?.name||'Custom',p.start_date,p.end_date,verified?paid:'Needs review',due,mode||'Unknown',!verified?'Needs review':due>0?(paid>0?'Partial':'Pending'):'Paid',message,whatsapp(m.phone,message)];
    if(p.kind==='admission')result.Admissions.push(row);else if(p.kind==='renewal')result.Renewals.push(row);
  }
  for(const m of [...s.members].sort((a,b)=>a.admission_id.localeCompare(b.admission_id,undefined,{numeric:true}))){
    const p=latest.get(m.id);result.Database.push([m.admission_id,m.full_name,p?.end_date||'']);
    if(p&&!m.is_archived&&!isReservedMember(m,reserved))result['Renewal List'].push([m.admission_id,m.full_name,p.end_date]);
  }
  const databaseIds=new Set(result.Database.slice(1).map(r=>r[0]));
  for(const [uid,m] of reserved){const id=m.admission_id||'ZF-'+uid;if(!databaseIds.has(id))result.Database.push([id,m.full_name,'']);}
  result['Renewal List']=[HEADERS['Renewal List'],...result['Renewal List'].slice(1).sort((a,b)=>a[2].localeCompare(b[2])||a[0].localeCompare(b[0]))];
  const periods=new Map(s.memberships.map(p=>[p.id,p]));const contracts=new Map((s.ptContracts||[]).map(c=>[c.id,c]));const receipts=[];
  for(const p of s.payments){const period=periods.get(p.membership_id),m=members.get(period?.member_id);if(!period||!m)throw new Error('Payment has no membership mapping.');const type=p.kind==='refund'?'Refund':period.kind==='admission'?'New Admission':'Renewal';receipts.push([indiaDay(p.paid_at),`${type} - ${m.category||'Regular'} - ${m.full_name} (${m.admission_id})`,type,Number(p.amount)*(p.kind==='refund'?-1:1),p.payment_mode,p.id]);}
  for(const p of s.ptPayments||[]){const c=contracts.get(p.contract_id),m=members.get(c?.member_id);if(!m)throw new Error('PT payment has no member mapping.');receipts.push([indiaDay(p.paid_at),`Personal Training - ${m.full_name} (${m.admission_id})`,'Personal Training',Number(p.amount),p.payment_mode,p.id]);}
  for(const r of s.historicalReceipts||[])receipts.push([indiaDay(r.received_at),r.description||'Historical receipt',r.transaction_type||'Historical receipt',Number(r.amount),r.payment_mode||'Unknown',r.id]);
  receipts.sort((a,b)=>a[0].localeCompare(b[0])||a[5].localeCompare(b[5]));result['Daily Cash Book'].push(...receipts.map(r=>r.slice(0,5)));
  const counter=Number(s.last_admission_id)||0;
  const last=Math.max(660,reserved.has(counter)?660:counter,...s.members.filter(m=>!isReservedMember(m,reserved)).map(m=>Number(m.device_user_id)||0));
  result['System Control'].push(['LastAdmissionID',last],['IDAuthority','Supabase'],['LastSuccessfulSync',s.generated_at],['GymID',s.gym_id],['SchemaVersion','zenith-fallback-v1']);
  return result;
}
module.exports={HEADERS,projectFallback};
