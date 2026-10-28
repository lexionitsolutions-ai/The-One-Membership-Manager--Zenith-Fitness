const {reservedDevices,isReservedMember}=require('./reservedDeviceIds');
const isPersonalTraining=member=>/^PT/i.test(String(member?.admission_id||'').trim());
function buildMemberReviews(data,today){
 const members=new Map((data.members||[]).map(m=>[m.id,m]));const reserved=reservedDevices({gym_id:data.gymId||data.gym_id,reserved_devices:data.reserved_devices});
 const periods=(data.memberships||[]).filter(p=>p.status==='confirmed');const latest=new Map();
 for(const p of periods)if(!latest.has(p.member_id)||p.end_date>latest.get(p.member_id).end_date)latest.set(p.member_id,p);
 const saved=new Map((data.memberReviews||[]).map(r=>[r.membership_id,r]));const rows=[];
 const eligible=m=>m&&!m.is_archived&&!isPersonalTraining(m)&&!isReservedMember(m,reserved);
 const row=(p,m,r,returned)=>({...p,member_name:m.full_name,admission_id:m.admission_id,phone:m.phone,expiry_month:p.end_date.slice(0,7),review_id:r?.id||null,review_status:returned?'Came Back & Renewed':r?.status==='Came Back & Renewed'?'Pending':r?.status||'Pending',reason:r?.reason||'',reason_other:r?.reason_other||'',return_date:r?.return_date||null,next_follow_up_date:r?.next_follow_up_date||null,remark:r?.remark||'',contact_type:r?.contact_type||'Call',review_updated_at:r?.updated_at||null,returned,new_end_date:returned?latest.get(m.id)?.end_date:null});
 for(const p of latest.values()){const m=members.get(p.member_id);if(eligible(m)&&p.end_date<today)rows.push(row(p,m,saved.get(p.id),false));}
 for(const [periodId,r] of saved){const p=periods.find(p=>p.id===periodId),m=members.get(r.member_id);if(p&&eligible(m)&&latest.get(m.id)?.end_date>p.end_date)rows.push(row(p,m,r,true));}
 return rows.sort((a,b)=>b.end_date.localeCompare(a.end_date)||a.id.localeCompare(b.id));
}
module.exports={isPersonalTraining,buildMemberReviews};
