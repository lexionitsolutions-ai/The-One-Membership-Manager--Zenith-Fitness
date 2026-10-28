// Authenticated Supabase requests. Store the exact pending command for safe retries.
window.zenithRequest=async function(path,body){
  const response=await fetch('/api/portal/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Open this form from the dashboard on port 3001.');
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'Unable to complete request.'),{status:response.status});return result;
};
window.zenithCommand=async function(command,payload){
  const key='zenith-command:'+command;const encoded=JSON.stringify(payload);let pending;
  try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
  if(pending&&pending.encoded!==encoded)throw new Error('A previous save has an uncertain result. Retry the original values, or reload and search again to check what was saved.');
  pending||={encoded,requestId:crypto.randomUUID()};sessionStorage.setItem(key,JSON.stringify(pending));
  try{const result=await zenithRequest('member-command',{command,payload,requestId:pending.requestId});sessionStorage.removeItem(key);
    try{const channel=new BroadcastChannel('zenith-membership-updates');channel.postMessage({type:'saved'});channel.close();}catch{}return result;
  }catch(error){if(error.status&&error.status<500)sessionStorage.removeItem(key);throw error;}
};
window.zenithFind=async function(value){
  const input=value.trim();return zenithRequest('member-details?'+(/^[A-Z]+-\d+$/i.test(input)?'admissionId='+encodeURIComponent(input):'mobile='+encodeURIComponent(input)));
};
window.zenithMonthEnd=function(start,months){const d=new Date(start+'T12:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(months));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);};
document.addEventListener('DOMContentLoaded',()=>{
  for(const command of ['profile','membership','payment','pt','pt_payment']){
    const key='zenith-command:'+command;let pending;try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
    if(!pending)continue;
    const box=document.createElement('div');box.className='status-message';
    const note=document.createElement('p');note.textContent='An earlier '+command.replace('_',' ')+' save has an uncertain result. Check it before entering another change.';
    const button=document.createElement('button');button.type='button';button.textContent='Check previous save';
    button.addEventListener('click',async()=>{button.disabled=true;try{await zenithCommand(command,JSON.parse(pending.encoded));note.textContent='The previous save is confirmed in Supabase. Search for the member again to load their latest details.';button.remove();}catch(e){note.textContent=e.message;button.disabled=false;}});
    box.append(note,button);document.querySelector('.form-intro').after(box);
  }
});
