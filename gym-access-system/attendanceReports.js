const {dayKey}=require('./reporting');const {reservedDevices,isReservedMember}=require('./reservedDeviceIds');
const shiftDay=(day,offset)=>new Date(new Date(day+'T12:00:00Z').getTime()+offset*86400000).toISOString().slice(0,10);
function buildAttendanceReport(data,now=new Date()){
 const today=dayKey(now),days=Array.from({length:7},(_,i)=>shiftDay(today,i-7));
 const reserved=reservedDevices({gym_id:data.gymId});
 const members=(data.members||[]).filter(m=>!m.is_archived&&!/^PT/i.test(String(m.admission_id||'').trim())&&m.device_user_id!=null&&!isReservedMember(m,reserved));
 const periods=data.memberships||[],logs=(data.attendance||[]).filter(a=>new Date(a.punched_at)<=now);
 const byMember=new Map((data.members||[]).map(m=>[m.id,m]));
 const visits=new Map(),lastSeen=new Map();for(const a of logs){const key=dayKey(a.punched_at)+':'+a.member_id;if(a.member_id){visits.set(key,true);if(!lastSeen.has(a.member_id)||new Date(a.punched_at)>new Date(lastSeen.get(a.member_id)))lastSeen.set(a.member_id,a.punched_at);}}
 const active=(m,day)=>periods.some(p=>p.member_id===m.id&&p.status==='confirmed'&&p.start_date<=day&&p.end_date>=day);
 const status=data.attendanceStatus;
 const completeThrough=status?.imported_at?shiftDay(dayKey(status.imported_at),-1):null;
 const covered=day=>Boolean(status?.records>0&&status?.coverage_start&&day>=status.coverage_start&&completeThrough&&day<=completeThrough);
 const info=m=>({member_id:m.id,member_name:m.full_name,admission_id:m.admission_id,phone:m.phone||'',last_seen:lastSeen.get(m.id)||null});
 const groups=days.map(day=>{const eligible=members.filter(m=>active(m,day)),present=eligible.filter(m=>visits.has(day+':'+m.id));return {day,covered:covered(day),active_count:eligible.length,present_count:present.length,absentees:covered(day)?eligible.filter(m=>!visits.has(day+':'+m.id)).map(info):[]};});
 const allCovered=days.every(covered);
 return {from:days[0],to:days[6],today,imported_at:status?.imported_at||null,coverage_start:status?.coverage_start||null,warning:status?.warning||null,device_time:status?.device_time||null,latest_device_punch:status?.latest_device_punch||null,allCovered,days:groups,
  consecutive:allCovered?members.filter(m=>days.every(day=>active(m,day)&&!visits.has(day+':'+m.id))).map(info):[],
  attendance:logs.filter(a=>dayKey(a.punched_at)>=days[0]&&dayKey(a.punched_at)<=today).sort((a,b)=>b.punched_at.localeCompare(a.punched_at)).map(a=>({...a,member_name:byMember.get(a.member_id)?.full_name||'Unmapped device user',admission_id:byMember.get(a.member_id)?.admission_id||a.device_user_id,phone:byMember.get(a.member_id)?.phone||''}))};
}
module.exports={buildAttendanceReport,shiftDay};
