async function syncPreview(button,accessDate){
  if(state.preview||state.data.source?.readOnly){toast('Sign in to the live Supabase workspace first.');return;}
  button.disabled=true;try{const p=await api('secondary-sync/preview'+(accessDate?'?date='+encodeURIComponent(accessDate):''));
    $('#entryTitle').textContent='Secondary sync preview';$('#entryError').textContent='';$('#saveEntry').hidden=true;
    $('#entryFields').innerHTML='<div class="wide"><p>Supabase last assigned ID: <strong>'+fmt(p.lastAdmissionID)+'</strong></p><p>Fallback workbook: '+escapeHtml(p.spreadsheetId||'Not configured')+'</p><p>Share the new workbook as Editor with: <strong>'+escapeHtml(p.serviceAccount||'Service account not configured')+'</strong></p><p>Device sync: '+(p.deviceEnabled?'Enabled':'Disabled')+'</p>'+table(['FALLBACK TAB','ROWS'],Object.entries(p.rows).map(([name,n])=>[escapeHtml(name),fmt(n)]))+'<p>'+escapeHtml(p.note)+'</p><p>IDs below come from Supabase. Team Zenith IDs are protected and retain their existing device access.</p>'+table(['MEMBER ID','NAME','FINGERPRINT ID','ACCESS'],p.devices.slice(0,100).map(m=>[escapeHtml(m.memberId),escapeHtml(m.name),fmt(m.uid),m.protectedTeam?'Team Zenith — preserved':m.active?'Allowed':'Restricted']))+'</div>';
    if(p.accessDate){const summary=document.createElement('p');summary.textContent='Access date: '+p.accessDate+' · Allowed: '+p.devices.filter(m=>m.active===true).length+' · Restricted: '+p.devices.filter(m=>m.active===false).length+' · Team protected: '+p.devices.filter(m=>m.protectedTeam).length;$('#entryFields').prepend(summary);}
    $('#entryDialog').showModal();
  }catch(e){toast(e.message);}finally{button.disabled=false;}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-sync-preview'))return syncPreview(button);
  if(button.dataset.accessDay){const today=state.data.today;const day=button.dataset.accessDay==='tomorrow'?new Date(new Date(today+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10):today;state.deviceSyncDate=day;$('#accessSyncDate').value=day;return;}
  if(button.hasAttribute('data-date-preview'))return syncPreview(button,$('#accessSyncDate').value);
  if(button.hasAttribute('data-device-date-sync')){
    if(state.preview||state.data.source?.readOnly){toast('Sign in to the live Supabase workspace first.');return;}
    const day=$('#accessSyncDate').value;state.deviceSyncDate=day;button.disabled=true;$('#dateSyncStatus').textContent='Syncing access for '+day+' from Supabase. Keep this page open...';
    try{const result=await api('fingerprint-date-sync',{method:'POST',body:JSON.stringify({date:day})});if(result.busy){$('#dateSyncStatus').textContent='Another sync is running. Wait for it to finish and retry.';}else{toast('Membership access synced for '+result.accessDate);await loadDashboard();$('#dateSyncStatus').textContent='Synced '+result.processed+' mapped members for '+result.accessDate+'. '+(result.protectedTeam||0)+' Team Zenith IDs preserved.';}}
    catch(error){$('#dateSyncStatus').textContent='Sync did not complete: '+error.message+' Retry the selected date to finish any partial update.';}finally{button.disabled=false;}return;
  }
  const destination=button.dataset.secondarySync;if(!destination)return;
  if(state.preview||state.data.source?.readOnly){toast('Sign in to the live Supabase workspace first.');return;}
  button.disabled=true;
  try{const result=await api('secondary-sync',{method:'POST',body:JSON.stringify({destination})});toast(result.busy?'A sync is already running.':`${destination==='google_sheets'?'Fallback workbook':'Fingerprint batch'} synced. ${result.completed} jobs completed.`);await loadDashboard();}
  catch(error){toast(error.message);}finally{button.disabled=false;}
});
document.addEventListener('change',event=>{if(event.target.id==='accessSyncDate')state.deviceSyncDate=event.target.value;});
