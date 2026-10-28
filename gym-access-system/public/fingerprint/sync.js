const $=id=>document.getElementById(id);
if($('formNavigation'))$('formNavigation').onchange=()=>location.assign($('formNavigation').value);
if(typeof location!=='undefined'&&new URLSearchParams(location.search).get('embedded')==='1')document.body.classList.add('embedded');
const indiaDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const tomorrow=new Date(new Date(indiaDay+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
let selected=tomorrow,generation=0,busy=false,ready=false;
async function api(path,body){const r=await fetch('/api/portal/'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json'}});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Request failed.'),{status:r.status});return data.queued&&data.jobId?window.zenithAwaitBridge(data.jobId):data;}
function status(text,error=false,kind='info'){$('status').textContent=text;$('status').classList.toggle('error',error);$('status').dataset.state=error?'error':kind;}

function dateLabel(day){return new Date(day+'T12:00:00+05:30').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});}
function controls(){for(const id of ['today','tomorrow','syncDate','refresh'])$(id).disabled=busy;$('syncButton').disabled=busy||!ready;}
async function preview(){if(busy)return;const seq=++generation;ready=false;controls();$('syncDate').value=selected;$('selectedDate').textContent='Access for '+dateLabel(selected);$('today').classList.toggle('secondary',selected!==indiaDay);$('tomorrow').classList.toggle('secondary',selected!==tomorrow);$('syncButton').textContent='Loading memberships…';
 try{const p=await api('secondary-sync/preview?date='+encodeURIComponent(selected));if(seq!==generation)return;
 $('activeCount').textContent=p.devices.filter(m=>m.active===true).length;$('inactiveCount').textContent=p.devices.filter(m=>m.active===false).length;$('teamCount').textContent=p.devices.filter(m=>m.protectedTeam).length;
 $('memberRows').replaceChildren();for(const m of p.devices){const row=document.createElement('tr');for(const value of [m.name,m.uid,m.protectedTeam?'Team — preserved':m.active?'Allowed':'Restricted']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('memberRows').append(row);}
 ready=p.devices.length>0&&(!p.bridge||p.bridge.online);if(p.bridge&&!p.bridge.online)status('Gym bridge is offline. Start the local Zenith app on the gym computer.',true);$('syncButton').textContent='Sync memberships for '+dateLabel(selected);if(!ready)status('No mapped members found in Supabase. Import existing members first.',true);
 }catch(e){status(e.message,true);$('syncButton').textContent='Load memberships first';}finally{if(seq===generation)controls();}}
$('syncDate').min=indiaDay;$('syncDate').max=tomorrow;
$('today').onclick=()=>{selected=indiaDay;preview();};$('tomorrow').onclick=()=>{selected=tomorrow;preview();};$('syncDate').onchange=()=>{selected=$('syncDate').value;preview();};$('refresh').onclick=preview;
$('syncButton').onclick=async()=>{if(busy||!ready)return;busy=true;controls();$('syncButton').textContent='Syncing… please wait';status('SYNC IN PROGRESS\nAccess date: '+dateLabel(selected)+'\nUpdating the fingerprint device. Keep this page open.','', 'pending');
 try{const r=await api('fingerprint-date-sync',{date:selected});if(r.busy){status('SYNC NOT STARTED\nAnother device sync is running. Wait for it to finish, then retry.',false,'warning');}else{
   if(r.success!==true||!Number.isInteger(r.processed)||r.processed<1)throw new Error('The server did not confirm a completed membership sync.');
   status('✓ SYNC SUCCESSFUL\nAccess date: '+dateLabel(r.accessDate)+'\nMembers processed: '+r.processed+'\nActive members allowed: '+r.accessAllowed+'\nInactive members restricted: '+r.accessRestricted+'\nTeam Zenith IDs preserved: '+(r.protectedTeam||0)+(r.attendanceRefresh?.success?'\nAttendance refreshed: '+r.attendanceRefresh.records+' punches.':r.attendanceRefresh?.error?'\nAttendance refresh needs retry: '+r.attendanceRefresh.error:r.attendanceRefresh?.busy?'\nAttendance refresh is already running.':''),false,'success');
 }}
 catch(e){status('✕ SYNC FAILED\nAccess date: '+dateLabel(selected)+'\n'+e.message+'\nRetry the same date to finish any partial update.',true);}finally{busy=false;controls();$('syncButton').textContent='Sync memberships for '+dateLabel(selected);$('status').scrollIntoView({behavior:'smooth',block:'nearest'});$('status').focus({preventScroll:true});}};
$('syncPanel').hidden=false;preview();
