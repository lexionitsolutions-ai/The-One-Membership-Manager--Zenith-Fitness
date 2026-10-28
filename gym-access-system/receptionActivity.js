function receptionActivity(data,range){
 const staff=data.staff||[],members=new Map((data.members||[]).map(m=>[m.id,m]));
 const periods=new Map((data.memberships||[]).map(p=>[p.id,p]));
 const leads=new Map((data.enquiries||[]).map(e=>[e.id,e]));
 const staffById=new Map(staff.map(s=>[s.id,s])),staffByUser=new Map(staff.map(s=>[s.user_id,s]));
 const activity=[];
 for(const h of data.enquiryFollowups||[]){
  const actor=staffByUser.get(h.actor_user_id);if(actor?.role!=='receptionist')continue;
  const lead=leads.get(h.enquiry_id);
  activity.push({id:h.id,section:'Follow-ups',person_name:lead?.full_name||'Enquiry',phone:lead?.phone||'',staff_name:actor.full_name,
   created_at:h.created_at,previous_status:h.from_status,status:h.to_status,next_follow_up_date:h.next_follow_up_date,remark:h.remark});
 }
 for(const h of data.memberReviewHistory||[]){
  const actor=staffById.get(h.recorded_by);if(actor?.role!=='receptionist')continue;
  const member=members.get(periods.get(h.membership_id)?.member_id);
  activity.push({id:h.id,section:'Review Members',person_name:member?.full_name||'Member',admission_id:member?.admission_id||'',phone:member?.phone||'',staff_name:actor.full_name,
   created_at:h.created_at,status:h.status,reason:h.reason==='Other'?h.reason_other:h.reason,return_date:h.return_date,next_follow_up_date:h.next_follow_up_date,contact_type:h.contact_type,remark:h.remark});
 }
 return activity.filter(h=>new Date(h.created_at)>=range.start&&new Date(h.created_at)<range.end)
  .sort((a,b)=>b.created_at.localeCompare(a.created_at)||String(a.id).localeCompare(String(b.id)));
}
module.exports={receptionActivity};
