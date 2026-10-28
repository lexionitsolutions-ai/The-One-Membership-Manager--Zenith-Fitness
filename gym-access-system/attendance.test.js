const {test}=require('node:test');const assert=require('node:assert/strict');
const {buildAttendanceReport}=require('./attendanceReports');const {prepareAttendance,createAttendanceImporter,deviceTime}=require('./attendanceImport');const {acquireDevice}=require('./deviceLock');
test('seven-day absence requires active membership on each fully imported completed day',()=>{
 const members=['all','visit','new','expired','team','pt','archived','unmapped'].map((id,i)=>({id,admission_id:id==='pt'?'PT-1':'ZF-'+(i+1),device_user_id:id==='team'?2985:id==='unmapped'?null:i+1,full_name:id,is_archived:id==='archived',phone:'9000000000'}));
 const data={gymId:'b80cd818-2abe-4a90-9027-e2ba1916aec4',members,memberships:members.map(m=>({member_id:m.id,status:'confirmed',start_date:m.id==='new'?'2026-10-26':'2026-10-01',end_date:m.id==='expired'?'2026-10-20':'2026-11-30'})),attendanceStatus:{coverage_start:'2026-10-01',records:2,imported_at:'2026-10-28T06:00:00Z'},attendance:[{member_id:'visit',punched_at:'2026-10-22T04:00:00Z'},{member_id:'visit',punched_at:'2026-10-22T05:00:00Z'},{member_id:'all',punched_at:'2026-10-28T14:00:00Z'}]};
 const now=new Date('2026-10-28T12:00:00Z');const report=buildAttendanceReport(data,now);
 assert.equal(report.from,'2026-10-21');assert.equal(report.to,'2026-10-27');assert.deepEqual(report.consecutive.map(m=>m.member_id),['all']);
 assert.equal(report.days.find(g=>g.day==='2026-10-22').present_count,1);assert.ok(report.days.at(-1).absentees.some(m=>m.member_id==='new'));
 assert.ok(!report.days[0].absentees.some(m=>m.member_id==='new'));assert.equal(report.attendance.length,2);
 data.attendanceStatus=null;assert.equal(buildAttendanceReport(data,now).allCovered,false);assert.equal(buildAttendanceReport(data,now).consecutive.length,0);assert.ok(buildAttendanceReport(data,now).days.every(g=>g.absentees.length===0));
 data.attendanceStatus={coverage_start:'2026-10-24',imported_at:'2026-10-28T06:00:00Z'};assert.equal(buildAttendanceReport(data,now).allCovered,false);assert.equal(buildAttendanceReport(data,now).days[0].covered,false);
});
test('device imports deduplicate retries, preserve unmapped IDs and use Indian wall-clock dates',()=>{
 const now=new Date('2026-10-28T10:00:00Z'),members=[{id:'m',device_user_id:660}];
 const logs=[{deviceUserId:'660',recordTime:'2026-10-21 07:15:00'},{deviceUserId:'660',recordTime:'2026-10-21 07:15:00'},{deviceUserId:'999',recordTime:'2026-10-27T08:00:00+05:30'},{deviceUserId:'660',recordTime:'2026-10-01T08:00:00+05:30'},{deviceUserId:'660',recordTime:'bad'}];
 const result=prepareAttendance(logs,members,'gym','device',now);assert.equal(result.rows.length,2);assert.equal(result.rows[0].punched_at,'2026-10-21T01:45:00.000Z');assert.equal(result.rows[1].member_id,null);assert.equal(result.coverage_start,'2026-10-21');assert.equal(result.invalid,1);
 assert.equal(result.rows[0].source_key,prepareAttendance(logs,members,'gym','device',now).rows[0].source_key);
 assert.equal(deviceTime('Wed Oct 28 2026 07:15:00 GMT+0000 (Coordinated Universal Time)').toISOString(),'2026-10-28T01:45:00.000Z');
});
test('device import yields to membership sync and never marks a failed database write as imported',async()=>{
 const saved={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY};process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='secret';let read=0,audits=0;
 const importer=createAttendanceImporter({readLogs:async()=>{read++;return [{deviceUserId:'1',recordTime:new Date(Date.now()-3600000).toISOString()}];},fetchImpl:async(url)=>{
  const p=new URL(url).pathname;if(p==='/rest/v1/members')return Response.json([{id:'m',device_user_id:1}]);if(p==='/rest/v1/attendance')return Response.json({error:'outage'},{status:503});if(p==='/rest/v1/audit_logs'){audits++;return Response.json([]);}throw Error('Unexpected');
 }});
 try{const release=acquireDevice();assert.equal((await importer.run('gym','actor')).busy,true);assert.equal(read,0);release();await assert.rejects(importer.run('gym','actor'),/503/);assert.equal(audits,0);const releaseAgain=acquireDevice();assert.equal(typeof releaseAgain,'function');releaseAgain();}
 finally{if(saved.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=saved.url;if(saved.key===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=saved.key;}
});
