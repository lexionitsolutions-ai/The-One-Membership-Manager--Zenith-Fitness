const crypto=require('node:crypto');const {acquireDevice}=require('./deviceLock');const {dayKey}=require('./reporting');const {shiftDay}=require('./attendanceReports');
async function readDeviceAttendance(){
 const {connectDevice}=require('./device');const device=await connectDevice();if(!device)throw new Error('Fingerprint device is unreachable.');
 try{const clock=await device.getTime();const result=await device.getAttendances();if(!Array.isArray(result?.data))throw new Error('Fingerprint attendance read was incomplete.');return {logs:result.data,clock};}finally{await device.disconnect();}
}
function deviceTime(value){
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))return null;const pad=n=>String(n).padStart(2,'0');return new Date(`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}+05:30`);}
 let s=String(value||'');
 // The SDK formats device-local clock fields with the host's timezone. Keep
 // those clock fields in IST instead of inheriting the server's timezone.
 const sdk=/^\w{3} (\w{3}) (\d{1,2}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT/.exec(s);
 if(sdk){const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(sdk[1])+1;if(!month)return null;s=`${sdk[3]}-${String(month).padStart(2,'0')}-${sdk[2].padStart(2,'0')}T${sdk[4]}+05:30`;}
 if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s))s=s.replace(' ','T')+'+05:30';const date=new Date(s);return Number.isFinite(date.getTime())?date:null;
}
function prepareAttendance(logs,members,gymId,deviceId,now=new Date()){
 const from=new Date(shiftDay(dayKey(now),-7)+'T00:00:00+05:30');const byDevice=new Map(members.filter(m=>m.device_user_id!=null).map(m=>[String(m.device_user_id),m]));const rows=new Map();let earliest=null,latest=null,invalid=0;
 for(const log of logs){const date=deviceTime(log.recordTime),raw=String(log.deviceUserId??log.userId??'').trim();
  if(date&&(!latest||date>latest))latest=date;
  if(!date||!raw||date>now){invalid++;continue;}if(!earliest||date<earliest)earliest=date;if(date<from)continue;
  const member=byDevice.get(raw.replace(/^ZF-/i,''));const timestamp=date.toISOString();const sourceKey='fingerprint:'+crypto.createHash('sha256').update(deviceId+'|'+raw+'|'+timestamp).digest('hex');
  rows.set(sourceKey,{gym_id:gymId,member_id:member?.id||null,device_user_id:raw,device_identifier:deviceId,punched_at:timestamp,access_result:'unknown',source_key:sourceKey});
 }
 const coverage=rows.size&&earliest?(earliest<=from?dayKey(from):shiftDay(dayKey(earliest),1)):null;
 return {rows:[...rows.values()],invalid,coverage_start:coverage,latest_device_punch:latest?.toISOString()||null};
}
function createAttendanceImporter({fetchImpl=fetch,readLogs=readDeviceAttendance}={}){
 const cache=new Map();
 async function service(endpoint,{method='GET',body,prefer}={}){
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error('Configure the Supabase server secret key to import attendance.');
  const response=await fetchImpl(new URL(endpoint,process.env.SUPABASE_URL),{method,headers:{apikey:key,Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{}),...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Attendance database request failed ('+response.status+').');const text=await response.text();return text?JSON.parse(text):null;
 }
 async function status(gymId){
  const value=cache.get(gymId);if(value)return value;
  try{const rows=await service(`/rest/v1/audit_logs?select=created_at,details&gym_id=eq.${encodeURIComponent(gymId)}&action=eq.attendance.imported&order=created_at.desc&limit=1`);return rows[0]?{...rows[0].details,imported_at:rows[0].details?.imported_at||rows[0].created_at}:null;}catch{return null;}
 }
 async function run(gymId,actorUserId){
  const release=acquireDevice();if(!release)return {busy:true};
  try{const now=new Date(),members=[];
   for(let offset=0;;offset+=500){const page=await service(`/rest/v1/members?select=id,device_user_id&gym_id=eq.${encodeURIComponent(gymId)}&order=id.asc&limit=500&offset=${offset}`);members.push(...page);if(page.length<500)break;if(offset>=50000)throw new Error('Member mapping is too large.');}
   const read=await readLogs(),logs=Array.isArray(read)?read:read.logs,clock=Array.isArray(read)?null:deviceTime(read.clock);
   const result=prepareAttendance(logs,members,gymId,process.env.DEVICE_IP||'192.168.31.202',now);
   const clockWrong=clock&&Math.abs(clock-now)>15*60000;
   if(clockWrong)result.coverage_start=null;
   for(let i=0;i<result.rows.length;i+=300)await service('/rest/v1/attendance?on_conflict=gym_id,source_key',{method:'POST',body:result.rows.slice(i,i+300),prefer:'resolution=merge-duplicates,return=minimal'});
   const details={imported_at:now.toISOString(),coverage_start:result.coverage_start,records:result.rows.length,invalid:result.invalid,device_time:clock?.toISOString()||null,latest_device_punch:result.latest_device_punch,warning:clockWrong?'The device clock differs from the current time. Verify its date and time before relying on absence reports.':!result.rows.length?'No punches were found in the current seven-day window. Check the device clock and log dates.':null};
   await service('/rest/v1/audit_logs',{method:'POST',body:{gym_id:gymId,actor_user_id:actorUserId,action:'attendance.imported',entity_type:'attendance',details}});
   cache.set(gymId,details);return {success:true,...details};
  }finally{release();}
 }
 return {run,status};
}
module.exports={createAttendanceImporter,prepareAttendance,deviceTime};
