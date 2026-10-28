// Integrated lead-manager workflow. All reads/writes use the authenticated portal.
const LEAD_STATUSES=['Pending','Call Done','WhatsApp Sent','Trial Done','Admission Done','Call Later','Not Interested','Wrong Number'];
const LEAD_FILTERS=['Today','Yesterday','Tomorrow','Overdue','All Pending','Trial Done','Admission Done','All leads'];
function leadStatus(e){return e.lead_status||({new:'Pending',contacted:'Call Done',converted:'Admission Done',closed:'Not Interested'})[e.status]||'Pending';}
function leadFollowUp(e){return e.next_follow_up_date||e.follow_up_date||'';}
function closedLead(e){return['Admission Done','Not Interested','Wrong Number'].includes(leadStatus(e));}
function offsetDay(date,offset){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
function leadMatches(e,filter,today,selectedDate=''){
  const due=leadFollowUp(e),status=leadStatus(e),closed=closedLead(e);
  if(selectedDate)return!closed&&due===selectedDate;
  if(filter==='All leads')return true;
  if(filter==='Admission Done')return status==='Admission Done';
  if(closed)return false;
  if(filter==='Today')return due===today;
  if(filter==='Yesterday')return due===offsetDay(today,-1);
  if(filter==='Tomorrow')return due===offsetDay(today,1);
  if(filter==='Overdue')return Boolean(due)&&due<today;
  if(filter==='Trial Done')return status==='Trial Done';
  return true;
}
function leadManagerRows(d){const f=filtersForPage();return(d.enquiries||[]).filter(e=>leadMatches(e,f.leadBucket||'Today',d.today,f.leadDate||'')).filter(matched).sort((a,b)=>(leadFollowUp(a)||'9999').localeCompare(leadFollowUp(b)||'9999'));}
function leadStatusBadge(e){const s=leadStatus(e);return `<span class="badge ${s==='Admission Done'?'':closedLead(e)?'gray':'amber'}">${escapeHtml(s)}</span>`;}
function leadContact(e){let phone=String(e.phone||'').replace(/\D/g,'');if(/^[1-9]\d{9}$/.test(phone))phone='91'+phone;return /^[1-9]\d{10,14}$/.test(phone)?phone:null;}
function leadWhatsApp(e){const phone=leadContact(e);const message=ZenithMessages.render('followup',{member_name:e.full_name||'there',phone:e.phone,address:e.address,plan:e.interested_plan,follow_up_date:leadFollowUp(e)},state.data?.whatsappTemplates||[]);return phone?`https://wa.me/${phone}?text=${encodeURIComponent(message)}`:null;}
function leadActions(e){const phone=leadContact(e),wa=leadWhatsApp(e);return `<div class="lead-actions">${phone?`<a class="button" href="tel:+${phone}">Call</a>`:'<span class="muted">Check phone</span>'}${wa?`<a class="button" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}<button class="button dark" data-edit-enquiry="${escapeHtml(e.id)}">Update</button><button class="text-button" data-lead-history="${escapeHtml(e.id)}">History</button></div>`;}
function enquirySetupNote(d){return d.enquirySetupRequired?'<div class="section-note">Run enquiry/lead setup migration 005 to enable all lead-manager fields and saving.</div>':'';}
function importEnquiriesButton(d){return state.role==='admin'&&d.enquiryImportAvailable&&!d.enquirySetupRequired?'<button class="button" data-import-enquiries>Import existing enquiry history</button>':'';}
function renderLeadManager(d){
  const rows=leadManagerRows(d),f=filtersForPage(),all=d.enquiries||[];
  const statCards=['Yesterday','Today','Tomorrow','Overdue','Admission Done','Trial Done'].map(key=>`<button class="lead-stat" data-lead-bucket="${key}"><span>${key}</span><strong>${fmt(all.filter(e=>leadMatches(e,key,d.today)).length)}</strong></button>`).join('');
  const cards=rows.slice(0,200).map(e=>`<article class="lead-card"><div class="lead-card-top"><div><h3>${escapeHtml(e.full_name)}</h3><span>${escapeHtml(e.phone||'No phone')}</span></div>${leadStatusBadge(e)}</div><dl><div><dt>Area / address</dt><dd>${escapeHtml(e.address||'—')}</dd></div><div><dt>Message / requirements</dt><dd>${escapeHtml(e.notes||'—')}</dd></div><div><dt>Interested in</dt><dd>${escapeHtml(e.interested_plan||'—')}</dd></div><div><dt>Source</dt><dd>${escapeHtml(e.source||'—')}</dd></div><div><dt>Next follow-up</dt><dd>${simpleDate(leadFollowUp(e))}</dd></div><div><dt>Remark</dt><dd>${escapeHtml(e.remark||'—')}</dd></div></dl>${e.needs_review?'<p class="plain-note">Some imported details need review.</p>':''}${leadActions(e)}</article>`).join('');
  return `${enquirySetupNote(d)}<div class="lead-stats">${statCards}</div><div class="lead-filter-tabs">${LEAD_FILTERS.map(k=>`<button data-lead-bucket="${k}" class="${!f.leadDate&&(f.leadBucket||'Today')===k?'selected':''}">${k}</button>`).join('')}</div><div class="management-filters"><label class="filter-field search-field">Search<input id="tableSearch" type="search" value="${escapeHtml(state.search)}" placeholder="Name, phone, interest, source or remark"></label><label class="filter-field">Follow-up date<input type="date" data-filter="leadDate" value="${escapeHtml(f.leadDate||'')}"></label><button class="button" data-clear-filters>Reset</button>${addButton('enquiry','Add enquiry')}${importEnquiriesButton(d)}</div><p class="plain-note">${fmt(rows.length)} matching leads. Closed leads stay out of daily follow-ups. WhatsApp opens a draft for you to review and send.</p><div class="lead-grid">${cards||empty('No follow-ups for this selection','Use All Pending, All leads or choose another follow-up date.')}</div>${resultsFooter(rows.length)}`;
}
function renderEnquiryRegister(d){const rows=managementRows('enquiries');return enquirySetupNote(d)+panel('Enquiry register','Full enquiry history. Use Follow-ups for daily calls and next actions.',filterBar({dates:true,statuses:LEAD_STATUSES,categories:[...new Set((d.enquiries||[]).map(e=>e.source).filter(Boolean))]})+table(['NAME','PHONE','INTEREST','SOURCE','FOLLOW-UP','STATUS','ACTIONS'],rows.slice(0,200).map(e=>[person(e.full_name),escapeHtml(e.phone||'Check phone'),escapeHtml(e.interested_plan||'—'),escapeHtml(e.source||'—'),simpleDate(leadFollowUp(e)),leadStatusBadge(e),leadActions(e)]),'No matching enquiries')+resultsFooter(rows.length),`<div class="row-actions">${importEnquiriesButton(d)}${addButton('enquiry','Add enquiry')}</div>`);}
function pendingAmountRows(d){
  const periods=new Map((d.memberships||[]).map(m=>[m.id,m]));
  const known=(d.balances||[]).map(b=>({...periods.get(b.id),...b,final_amount:b.final_amount??b.historical_charge,balance_status:'Confirmed due',paid_amount:Number(b.final_amount??b.historical_charge)-b.outstanding}));
  const unknown=(d.memberships||[]).filter(m=>m.status==='confirmed'&&m.accounting_verified===false).map(m=>({...m,outstanding:null,paid_amount:null,balance_status:'Needs review'}));
  return [...known,...unknown];
}
function renderPendingAmounts(d){
  const f=filtersForPage();if(f.status===undefined)f.status='Confirmed due';
  const rows=managementRows('pending'),total=rows.reduce((s,m)=>s+Number(m.outstanding||0),0),members=new Set(rows.filter(m=>m.outstanding>0).map(m=>m.member_id));
  return `<div class="stats-grid three">${stat('Confirmed pending amount',rupees(total),'₹','Matching verified balances',true)}${stat('Members with dues',fmt(members.size),'♧','Matching verified balances')}${stat('Historical periods to review',fmt(d.metrics.unreconciledPeriods),'!','Unknown balances are not counted as zero')}</div>${panel('Pending Amounts','Each row represents one membership period. Recording a payment updates the balance.',filterBar({dates:true,packages:true,statuses:['Confirmed due','Needs review']})+table(['MEMBER','PERIOD ENDS','CHARGE','PAID','PENDING','STATUS','WHATSAPP MESSAGE','ACTION'],rows.slice(0,200).map(m=>[person(m.member_name,m.admission_id),simpleDate(m.end_date),rupees(m.final_amount),m.paid_amount===null?'Unknown':rupees(m.paid_amount),m.outstanding===null?'Needs reconciliation':rupees(m.outstanding),badge(m.balance_status),sharedMessageColumn('pending',m),m.outstanding>0?`<button class="row-action" data-record-due="${escapeHtml(m.id)}">Record payment</button>`:'—']),'No matching pending balances')+resultsFooter(rows.length),state.role==='admin'?'<button class="button" data-reconcile-pending>Reconcile imported sheet balances</button>':'')}`;
}
async function showLeadHistory(id){
  if(state.preview){toast('Sample preview: no follow-up history is stored.');return;}
  try{const data=await api(`enquiries/${id}/history`);$('#entryTitle').textContent='Follow-up history';$('#entryFields').innerHTML=(data.history||[]).map(h=>`<article class="history-item"><strong>${escapeHtml(h.from_status||'New')} → ${escapeHtml(h.to_status)}</strong><p>${simpleDate(h.created_at)} · ${time(h.created_at)} IST</p><p>Next follow-up: ${simpleDate(h.next_follow_up_date)}</p><p>${escapeHtml(h.remark||'No remark')}</p></article>`).join('')||empty('No updates recorded yet');$('#saveEntry').hidden=true;$('#entryError').textContent='';$('#entryDialog').showModal();}catch(e){toast(e.message);}
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.leadBucket){filtersForPage().leadBucket=b.dataset.leadBucket;filtersForPage().leadDate='';renderPage();}
  if(b.dataset.recordDue)openEntry('payment',b.dataset.recordDue);
  if(b.dataset.leadHistory)showLeadHistory(b.dataset.leadHistory);
  let endpoint;
  if(b.hasAttribute('data-import-enquiries'))endpoint='enquiries/import-history';
  if(b.hasAttribute('data-reconcile-pending'))endpoint='pending/reconcile';
  if(endpoint){
    if(state.preview||state.data.source?.readOnly){toast('This action requires the live Supabase workspace.');return;}
    b.disabled=true;try{const r=await api(endpoint,{method:'POST',body:'{}'});toast(endpoint.startsWith('pending')?`${r.reconciled} balances reconciled.`:`${r.imported} historical enquiries imported.`);await loadDashboard();}catch(e){toast(e.message);}finally{b.disabled=false;}
  }
});
