// Supabase is the primary write destination. No Apps Script POST fallback.
window.submitToZenithDatabase=async function(formData){
  if(!['http:','https:'].includes(location.protocol))throw new Error('Open this form from http://localhost:3001/forms/index.html.');
  const body=Object.fromEntries(formData.entries());
  // Refresh saved templates before generating the confirmation draft.
  if(window.ZenithMessages)await window.ZenithMessages.refresh().catch(()=>{});
  const key='zenith-form-request:'+body.action;
  let requestId;
  try{requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}}
  catch{requestId=crypto.randomUUID();}
  body.requestId=requestId;
  const response=await fetch('/api/portal/form-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Open this form from the gym app on port 3001.');
  const data=await response.json();
  if(!response.ok){
    throw new Error(data.error||'Could not save to Supabase.');
  }
  if(data.success){
    try{sessionStorage.removeItem(key);}catch{}
    try{const channel=new BroadcastChannel('zenith-membership-updates');channel.postMessage({type:'saved'});channel.close();}catch{}
  }
  return{text:async()=>JSON.stringify(data)};
};
