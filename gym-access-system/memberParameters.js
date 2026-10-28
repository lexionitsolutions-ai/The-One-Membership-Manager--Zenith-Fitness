const {dayKey,validDate}=require('./reporting');
const areas=['Hanuman Nagar','Pachgaon','Jarag Nagar','Kalamba','Hockey Stadium','Sambhaji Nagar','Nale Colony','Shivaji Peth','Phulewadi'];
function gender(value){const s=String(value||'').trim().toLowerCase();return ['male','m'].includes(s)?'Male':['female','f'].includes(s)?'Female':'Not recorded';}
function area(value){const s=String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');return !s?'Not recorded':areas.find(a=>s.includes(a.toLowerCase().replace(/[^a-z0-9]/g,'')))||'Other';}
function buckets(values,labels=[]){const counts=new Map(labels.map(label=>[label,0]));for(const value of values)counts.set(value,(counts.get(value)||0)+1);return [...counts].map(([label,count])=>({label,count}));}
function parameterFilter(query={},now=new Date()){
 const status=query.parameterStatus||'all',period=query.parameterPeriod||'all',today=dayKey(now);
 if(!['all','active','inactive'].includes(status)||!['all','custom'].includes(period))throw Object.assign(new Error('Choose a valid member status and parameter period.'),{status:400});
 if(period==='custom'&&(!validDate(query.parameterFrom)||!validDate(query.parameterTo)||query.parameterFrom>query.parameterTo||query.parameterTo>today))throw Object.assign(new Error('Choose a valid custom period, ending today or earlier.'),{status:400});
 return {status,period,from:period==='all'?null:query.parameterFrom,to:period==='all'?today:query.parameterTo,allTime:period==='all'};
}
function memberParameters(data,range,filter={}){
 const periods=data.memberships||[],active=new Set(periods.filter(p=>p.status==='confirmed'&&p.start_date<=range.to&&p.end_date>=range.to).map(p=>p.member_id));
 const joined=m=>m.created_at?dayKey(m.created_at):periods.filter(p=>p.member_id===m.id&&p.kind==='admission'&&p.status==='confirmed').map(p=>p.purchased_at?dayKey(p.purchased_at):p.start_date).sort()[0];
 const eligible=(data.members||[]).filter(m=>!m.is_archived&&(!m.created_at||dayKey(m.created_at)<=range.to)&&(filter.status!=='active'||active.has(m.id))&&(filter.status!=='inactive'||!active.has(m.id)));
 const members=eligible.filter(m=>filter.period!=='custom'||Boolean(joined(m)&&joined(m)>=range.from&&joined(m)<=range.to));
 const selectedIds=new Set(eligible.map(m=>m.id));
 const byId=new Map((data.members||[]).map(m=>[m.id,m]));
 const addresses=new Map((data.privateDetails||[]).map(d=>[d.member_id,d.address]));
 const renewals=(data.memberships||[]).filter(p=>p.kind==='renewal'&&p.status==='confirmed'&&(!filter.status||filter.status==='all'||selectedIds.has(p.member_id))&&!/^PT/i.test(String(byId.get(p.member_id)?.admission_id||'').trim())&&(!range.from||(p.purchased_at?dayKey(p.purchased_at):p.start_date)>=range.from)&&(p.purchased_at?dayKey(p.purchased_at):p.start_date)<=range.to);
 return {asOf:range.to,from:range.from,to:range.to,status:filter.status||'all',allTime:Boolean(filter.allTime),customCohort:filter.period==='custom',memberGender:buckets(members.map(m=>gender(m.gender)),['Male','Female','Not recorded']),renewalGender:buckets(renewals.map(p=>gender(byId.get(p.member_id)?.gender)),['Male','Female','Not recorded']),areas:buckets(members.map(m=>area(addresses.get(m.id)||m.address)))};
}
function cashbookEntry(p,data){
 if(p.source==='cashbook')return {description:p.description||p.member_name||'Historical receipt',transaction_type:p.transaction_type||'Historical receipt'};
 let period=(data.memberships||[]).find(m=>m.id===p.membership_id),contract=(data.ptContracts||[]).find(c=>c.id===p.contract_id);
 const member=(data.members||[]).find(m=>m.id===(period?.member_id||contract?.member_id));
 const plan=(data.plans||[]).find(t=>t.id===period?.plan_id);
 const type=p.kind==='refund'?'Refund':contract?'Personal Training':period?.kind==='renewal'?'Renewal':period?.kind==='admission'?'New Admission':'Payment';
 const detail=contract?(contract.package==='custom'?'Custom PT':contract.package+' Month PT'):period?.kind==='renewal'?(plan?.name||'Custom package'):(member?.category||'Regular');
 return {description:`${type} - ${detail} - ${member?.full_name||p.member_name||'Unknown member'}${member?.admission_id?' ('+member.admission_id+')':''}`,transaction_type:type};
}
module.exports={memberParameters,cashbookEntry,parameterFilter};
