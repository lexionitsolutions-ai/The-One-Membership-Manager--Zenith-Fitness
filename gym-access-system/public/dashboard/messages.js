const messageSamples={reason:'Busy schedule',return_date:'10-11-2026',next_follow_up_date:'03-11-2026',member_name:'Sample Member',admission_id:'ZF-661',phone:'9876543210',plan:'3 Months',start_date:'01-11-2026',end_date:'30-01-2027',amount_paid:'₹ 4,000',pending_amount:'₹ 500',trainer_name:'Lakhan',address:'Hanuman Nagar',follow_up_date:'01-11-2026'};
function sharedMessageColumn(key,row){
 if(key==='pending'&&row.outstanding==null)return '<span class="muted">Reconcile the balance before messaging.</span>';
 const member=(state.data.members||[]).find(m=>m.id===row.member_id);const phone=row.phone||member?.phone||'';
 const message=ZenithMessages.render(key,{member_name:row.member_name||member?.full_name,admission_id:row.admission_id||member?.admission_id,phone,plan:row.plan_name||(row.package==='custom'?'Custom PT':row.package+' Month(s)'),start_date:row.start_date,end_date:row.end_date,amount_paid:row.paid_amount==null?'':rupees(row.paid_amount),pending_amount:row.outstanding==null?'':rupees(row.outstanding),trainer_name:row.trainer_name},state.data.whatsappTemplates||[]);
 const url=ZenithMessages.url(phone,message);
 return '<div class="whatsapp-cell">'+(url?'<a class="whatsapp-action" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">Open WhatsApp</a>':'Valid phone needed')+'<details class="whatsapp-preview"><summary>View prefilled message</summary><p>'+escapeHtml(message)+'</p></details></div>';
}
function messageSpec(){return ZenithMessages.specs.find(s=>s.template_key===(state.messageKey||'admission'));}
function messageDraft(){state.messageDrafts||={};const spec=messageSpec();return state.messageDrafts[spec.template_key]||={...(state.data.whatsappTemplates||[]).find(t=>t.template_key===spec.template_key)||spec};}
function renderMessages(d){
 const spec=messageSpec(),draft=messageDraft();
 return (d.whatsappSetupRequired?'<div class="section-note">Run migration 010 to enable saving these shared WhatsApp templates.</div>':'')+panel('WhatsApp Messages','One set of messages for your forms, member lists and fallback sheets. Messages open as drafts for staff to review and send.',
 '<div class="message-editor"><div><label class="form-field">Message type<select id="messageType">'+ZenithMessages.specs.map(s=>'<option value="'+s.template_key+'" '+(s.template_key===spec.template_key?'selected':'')+'>'+escapeHtml(s.title)+'</option>').join('')+'</select></label><p class="plain-note">Insert a field where its value should appear:</p><div class="message-tokens">'+spec.variables.map(v=>'<button class="button" data-message-token="'+v+'">{{'+v+'}}</button>').join('')+'</div><label class="form-field">Message<textarea id="messageBody" rows="16" maxlength="6000">'+escapeHtml(draft.body)+'</textarea></label><p class="plain-note"><span id="messageLength">'+draft.body.length+'</span> / 6000 characters</p><p id="messageError" class="form-error" role="alert"></p><div class="heading-actions"><button class="button dark" id="saveMessage" '+(d.whatsappSetupRequired?'disabled':'')+'>Save message</button><button class="button" id="reloadMessage">Reload saved message</button></div></div><div><h3>Message preview</h3><p class="plain-note">Sample values only.</p><pre id="messagePreview" class="message-preview">'+escapeHtml(ZenithMessages.render(spec.template_key,messageSamples,[draft]))+'</pre></div></div>');
}
function updateMessagePreview(){const draft=messageDraft();draft.body=$('#messageBody').value;$('#messageLength').textContent=draft.body.length;$('#messagePreview').textContent=ZenithMessages.render(messageSpec().template_key,messageSamples,[draft]);}
document.addEventListener('input',e=>{if(e.target.id==='messageBody')updateMessagePreview();});
document.addEventListener('change',e=>{if(e.target.id==='messageType'){state.messageKey=e.target.value;renderPage();}});
document.addEventListener('click',async e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.dataset.messageToken){const input=$('#messageBody');input.setRangeText('{{'+button.dataset.messageToken+'}}',input.selectionStart,input.selectionEnd,'end');input.focus();updateMessagePreview();}
 if(button.id==='reloadMessage'){delete state.messageDrafts[messageSpec().template_key];renderPage();}
 if(button.id==='saveMessage'){
  if(state.preview){toast('Preview only: messages are not saved.');return;}
  const spec=messageSpec(),draft=messageDraft();const unknown=[...draft.body.matchAll(/\{\{([^{}]*)\}\}/g)].map(m=>m[1]).find(v=>!spec.variables.includes(v));
  if(!draft.body.trim()||unknown){$('#messageError').textContent=unknown?'Unknown placeholder: '+unknown:'Enter a message.';return;}
  button.disabled=true;$('#messageError').textContent='';
  try{const result=await api('whatsapp-templates/'+spec.template_key,{method:'PUT',body:JSON.stringify({body:draft.body,expected_updated_at:draft.updated_at})});state.messageDrafts[spec.template_key]={...result.template};toast('WhatsApp message saved.');await loadDashboard();}
  catch(error){$('#messageError').textContent=error.message;}finally{button.disabled=false;}
 }
});
