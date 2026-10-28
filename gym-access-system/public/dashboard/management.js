// Administrative pages share the portal's authentication and role-filtered data.
const managementDateFormat=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const packageOptions=[{id:'30',name:'1 Month'},{id:'90',name:'3 Months'},{id:'180',name:'6 Months'},{id:'365',name:'1 Year'},{id:'custom',name:'Customize Packages'}];
const membershipDayFormat=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Kolkata'});
function membershipRecordDate(row){return row.purchased_at?membershipDayFormat.format(new Date(row.purchased_at)):row.start_date;}
function membershipWhatsApp(row,type){
  const member=(state.data?.members||[]).find(m=>m.id===row.member_id);
  const raw=String(row.phone||member?.phone||'').trim();
  let phone=raw.replace(/[^0-9]/g,'');
  if(/^[1-9]\d{9}$/.test(phone))phone='91'+phone;
  const valid=/^[1-9]\d{10,14}$/.test(phone)&&!/[A-Za-z]/.test(raw);
  const name=row.member_name||member?.full_name||'Member';
  const code=row.admission_id||member?.admission_id||'—';
  const plan=packageOptions.find(p=>p.id===row.package_group)?.name||row.plan_name||'Customize Package';
  const message=ZenithMessages.render(type==='renewals'?'renewal_reminder':type==='renewed'?'renewed':'admission',{member_name:name,admission_id:code,phone:raw,plan,start_date:row.start_date,end_date:row.end_date,amount_paid:row.paid_amount??'',pending_amount:row.outstanding??''},state.data?.whatsappTemplates||[]);
  return {message,url:valid&&row.status!=='cancelled'?`https://wa.me/${phone}?text=${encodeURIComponent(message)}`:null};
}
function whatsappColumn(row,type){
  const {message,url}=membershipWhatsApp(row,type);
  if(row.status==='cancelled')return '<span class="whatsapp-unavailable">Cancelled record</span>';
  return `<div class="whatsapp-cell">${url?`<a class="whatsapp-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open WhatsApp ↗</a>`:'<span class="whatsapp-unavailable">Valid phone needed</span>'}<details class="whatsapp-preview"><summary>View prefilled message</summary><p>${escapeHtml(message)}</p></details></div>`;
}
function filtersForPage(){state.filters ||= {};return state.filters[state.page] ||= {};}
function activeFilters(row,{dateField,planField,statusField,methodField,categoryField}={}){
  const f=filtersForPage();
  if(!matched(row))return false;
  const value=String(row[dateField]||'').slice(0,10);
  if(f.from&&(!value||value<f.from))return false;
  if(f.to&&(!value||value>f.to))return false;
  if(f.month&&!value.startsWith(f.month))return false;
  if(f.plan&&row[planField]!==f.plan)return false;
  if(f.status&&String(row[statusField])!==f.status)return false;
  if(f.method&&row[methodField]!==f.method)return false;
  if(f.category&&row[categoryField]!==f.category)return false;
  if(f.package&&row.package_group!==f.package)return false;
  return true;
}
function filterBar({dates=false,plans=false,packages=false,statuses=[],methods=[],categories=[],month=false}={}){
  const f=filtersForPage();
  const select=(key,label,options)=>`<label class="filter-field">${label}<select data-filter="${key}"><option value="">All ${label.toLowerCase()}</option>${options.map(o=>{const v=typeof o==='string'?o:o.id;const name=typeof o==='string'?o:o.name;return `<option value="${escapeHtml(v)}" ${f[key]===v?'selected':''}>${escapeHtml(name)}</option>`;}).join('')}</select></label>`;
  return `<div class="management-filters"><label class="filter-field search-field">Search<input id="tableSearch" type="search" placeholder="Name, ID, phone or description" value="${escapeHtml(state.search)}"></label>${dates?`<label class="filter-field">From<input type="date" data-filter="from" value="${escapeHtml(f.from||'')}"></label><label class="filter-field">To<input type="date" data-filter="to" value="${escapeHtml(f.to||'')}"></label>`:''}${month?`<label class="filter-field">Month<input type="month" data-filter="month" value="${escapeHtml(f.month||'')}"></label>`:''}${plans?select('plan','Plans',state.data.plans||[]):''}${packages?select('package','Packages',packageOptions):''}${statuses.length?select('status','Status',statuses):''}${methods.length?select('method','Methods',methods):''}${categories.length?select('category','Categories',categories):''}<button class="button clear-filters" data-clear-filters>Reset</button></div>`;
}
function addButton(kind,label){return `<button class="button dark" data-add="${kind}">+ ${label}</button>`;}
function resultsFooter(count){return `<div class="table-bottom"><span>${fmt(count)} matching records · showing up to 200</span>${state.role==='receptionist'?'':'<span>Export downloads all matching records</span>'}</div>`;}
function simpleDate(value){return value?managementDateFormat.format(new Date(value.length===10?`${value}T12:00:00+05:30`:value)):'—';}
function overviewSection(key,title,subtitle,body){
 return `<details class="overview-section" data-overview-section="${key}" ${state.overviewSections?.[key]?'open':''}><summary><span><strong>${title}</strong><small>${escapeHtml(subtitle)}</small></span><span class="overview-chevron" aria-hidden="true">&#8964;</span></summary><div class="overview-section-body">${body}</div></details>`;
}
function receptionActivitySection(d){
 const rows=d.receptionActivity||[];
 const renderRows=section=>rows.filter(h=>h.section===section).map(h=>[
 `<strong>${escapeHtml(h.person_name)}</strong><div class="activity-meta">${escapeHtml(h.admission_id||h.phone)}</div>`,
 `<strong>${escapeHtml(h.staff_name)}</strong><div class="activity-meta">${date(h.created_at)} &middot; ${time(h.created_at)}</div>`,
 `${escapeHtml(h.previous_status?h.previous_status+' > '+h.status:h.status)}<div class="activity-meta">${escapeHtml(h.contact_type||'')}</div>`,
 `<div>${h.reason?`Reason: ${escapeHtml(h.reason)}`:''}</div><div>${h.return_date?`Expected return: ${date(h.return_date)}`:''}</div><div>${h.next_follow_up_date?`Next follow-up: ${date(h.next_follow_up_date)}`:''}</div><p class="activity-remark">${escapeHtml(h.remark||'')}</p>`]);
 const notice=d.receptionActivitySetupRequired?'<p class="section-note">Follow-up history setup is incomplete. Run migrations 005 and 011 to see both activity lists.</p>':'';
 return overviewSection('receptionActivity','Receptionist updates',`${fmt(rows.length)} updates in the selected report period`,notice+['Follow-ups','Review Members'].map(section=>`<h3 class="activity-heading">${section}</h3>${table(['MEMBER / ENQUIRY','UPDATED BY / WHEN','STATUS','FOLLOW-UP DETAILS'],renderRows(section),'No receptionist updates in this period.')}`).join(''));
}
document.addEventListener('toggle',event=>{
 const key=event.target?.dataset?.overviewSection;
 if(key){state.overviewSections ||= {};state.overviewSections[key]=event.target.open;}
},true);
function parametersQuery(){
 const f=state.parameterFilters||{status:'all',period:'all'};
 return '&'+new URLSearchParams({parameterStatus:f.status,parameterPeriod:f.period==='all'?'all':'custom',...(f.period==='all'?{}:{parameterFrom:f.from,parameterTo:f.to})}).toString();
}
function renderParametersPage(d){
 const f=state.parametersDraft||state.parameterFilters||{status:'all',period:'all'},today=d.today;
 const option=(value,label,current)=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`;
 const p=d.memberParameters;
 return `<section class="panel"><h2>Filter parameters</h2><div class="parameters-filters"><label>Member status<select id="parameterStatus">${[['all','All members'],['active','Active'],['inactive','Non-active']].map(([v,l])=>option(v,l,f.status)).join('')}</select></label><label>Time period<select id="parameterPeriod">${[['all','All time'],['today','Today'],['month','This month'],['year','This year'],['custom','Custom period']].map(([v,l])=>option(v,l,f.period)).join('')}</select></label><label ${f.period==='custom'?'':'hidden'}>From<input id="parameterFrom" type="date" max="${today}" value="${escapeHtml(f.from||today.slice(0,7)+'-01')}"></label><label ${f.period==='custom'?'':'hidden'}>To<input id="parameterTo" type="date" max="${today}" value="${escapeHtml(f.to||today)}"></label><button class="button dark" data-apply-parameters>Apply filters</button><button class="button" data-reset-parameters>Reset</button></div><p class="plain-note">Status is checked on the period's end date. With a date period, member and area charts show members admitted in that period; the renewal chart shows renewal transactions in that period.</p>${p?`<p class="plain-note"><strong>${p.status==='active'?'Active':p.status==='inactive'?'Non-active':'All'} members</strong> &middot; ${p.allTime?'All time':simpleDate(p.from)+' - '+simpleDate(p.to)} &middot; Status as of ${simpleDate(p.asOf)}</p>`:''}</section>${renderParameterCharts(d,true)}`;
}
function parameterDraft(){return {status:$('#parameterStatus').value,period:$('#parameterPeriod').value,from:$('#parameterFrom').value,to:$('#parameterTo').value};}
document.addEventListener('change',event=>{if(['parameterStatus','parameterPeriod','parameterFrom','parameterTo'].includes(event.target.id)){state.parametersDraft=parameterDraft();if(event.target.id==='parameterPeriod')renderPage();}});
document.addEventListener('click',async event=>{
 if(event.target.closest('[data-reset-parameters]')){state.parameterFilters={status:'all',period:'all'};state.parametersDraft=null;await loadDashboard();return;}
 if(!event.target.closest('[data-apply-parameters]'))return;
 const f=parameterDraft(),today=state.data.today;
 if(f.period!=='all'){
  if(f.period==='today')f.from=f.to=today;
  if(f.period==='month'){f.from=today.slice(0,7)+'-01';f.to=today;}
  if(f.period==='year'){f.from=today.slice(0,4)+'-01-01';f.to=today;}
  if(!f.from||!f.to||f.from>f.to||f.to>today){toast('Choose valid dates ending today or earlier.');return;}
 }
 state.parameterFilters=f;state.parametersDraft={...f};await loadDashboard();
});
function renderParameterCharts(d,standalone=false){
 const p=d.memberParameters;if(!p)return '';
 const colors=['#c19a48','#414f72','#97aaa2','#b38c9c','#7e9fc0','#b3a16f','#8877a2','#8ca868','#cf9874','#76889b','#d5bdb5'];
 function pie(title,values,note){
  const total=values.reduce((sum,v)=>sum+v.count,0);let offset=0;
  const stops=values.filter(v=>v.count>0).map((v,i)=>{const start=offset;offset+=v.count/total*100;return `${colors[i%colors.length]} ${start}% ${offset}%`;});
  const nonzero=values.filter(v=>v.count>0);
  return `<article class="parameter-card"><h3>${title}</h3><p>${note}</p>${total?`<div class="parameter-content"><div class="parameter-pie" role="img" aria-label="${escapeHtml(title+': '+nonzero.map(v=>v.label+' '+v.count).join(', '))}" style="background:conic-gradient(${stops.join(',')})"></div><ul class="parameter-legend">${values.map(v=>{const color=colors[nonzero.indexOf(v)%colors.length]||'#d5d8dd';return `<li><span class="parameter-dot" style="background:${color}"></span><span>${escapeHtml(v.label)}</span><strong>${fmt(v.count)}</strong><small>${total?(v.count/total*100).toFixed(1):'0'}%</small></li>`;}).join('')}</ul></div><div class="parameter-total">Total: ${fmt(total)}</div>`:empty('No records in this period')}</article>`;
 }
 const charts=`<div class="parameters-grid">${pie('Male and female members',p.memberGender,`Members as of ${simpleDate(p.asOf)}`)}${pie('Male and female renewals',p.renewalGender,`Renewal transactions: ${p.allTime?'All time':simpleDate(p.from)+' - '+simpleDate(p.to)}`)}${pie('Area-wise memberships',p.areas,'One count per member; missing addresses remain unrecorded.')}</div>`;
 return standalone?charts:overviewSection('parameters','Membership parameters','Gender and locality distributions',charts);
}
function attendanceCall(phone){
 let number=String(phone||'').replace(/\D/g,'');if(number.length===10)number='91'+number;
 return /^[1-9]\d{9,14}$/.test(number)?`<a class="button attendance-call" href="tel:+${number}">Call</a>`:'<span class="muted">No valid phone</span>';
}
function attendanceViewRows(d){
 const r=d.weeklyAttendance,mode=state.attendanceMode||'attendance';
 const day=state.attendanceDay===r.today?r.today:r.days.some(g=>g.day===state.attendanceDay)?state.attendanceDay:r.to;
 let rows=mode==='consecutive'?r.consecutive:mode==='absent'?(r.days.find(g=>g.day===day)?.absentees||[]).map(m=>({...m,day})):r.attendance.filter(a=>!state.attendanceDay||state.attendanceDay==='all'||membershipDayFormat.format(new Date(a.punched_at))===day);
 return rows.filter(m=>matched(m));
}
function renderWeeklyAttendance(d){
 const r=d.weeklyAttendance,mode=state.attendanceMode||'attendance';
 const day=r.days.some(g=>g.day===state.attendanceDay)?state.attendanceDay:r.to,group=r.days.find(g=>g.day===day);
 const rows=attendanceViewRows(d),visible=rows.slice(0,state.attendanceLimit||100);
 const options=(mode==='attendance'?`<option value="all" ${!state.attendanceDay||state.attendanceDay==='all'?'selected':''}>All dates</option><option value="${r.today}" ${state.attendanceDay===r.today?'selected':''}>Today</option>`:'')+r.days.slice().reverse().map(g=>`<option value="${g.day}" ${state.attendanceDay===g.day||mode==='absent'&&(!state.attendanceDay||state.attendanceDay==='all')&&g.day===day?'selected':''}>${simpleDate(g.day)}</option>`).join('');
 const controls=`<div class="attendance-tabs">${[['attendance','Attendance'],['absent','Daily absentees'],['consecutive','Absent 7 consecutive days']].map(([key,label])=>`<button class="button ${mode===key?'dark':''}" data-attendance-mode="${key}" aria-pressed="${mode===key}">${label}</button>`).join('')}</div>${toolbar('Search member, admission ID or phone')}<div class="attendance-controls">${mode!=='consecutive'?`<label>Date<select id="attendanceDay">${options}</select></label>`:''}<button class="button dark" data-refresh-attendance ${state.attendanceRefreshing?'disabled':''}>${state.attendanceRefreshing?'Reading device...':'Refresh from fingerprint device'}</button></div>`;
 const deviceWarning=r.warning?`<p class="section-note">${escapeHtml(r.warning)}${r.latest_device_punch?' Latest device punch: '+simpleDate(r.latest_device_punch):''}${r.device_time?' Device date: '+simpleDate(r.device_time):''}</p>`:'';
 const coverage=!r.allCovered?'<p class="section-note">A complete seven-day device history is not available yet. Refresh from the device. Absentees are shown only for fully imported days.</p>':'';
 const summary=mode==='absent'?`<p class="plain-note">${group?.covered?`${fmt(group.active_count)} active members, ${fmt(group.present_count)} with punches, ${fmt(group.absentees.length)} without punches.`:'This day has not been fully imported; no absentee list is inferred.'}</p>`:'';
 const content=mode==='attendance'?table(['MEMBER','DATE','TIME','PHONE','CALL'],visible.map(a=>[person(a.member_name,a.admission_id),simpleDate(a.punched_at),time(a.punched_at),escapeHtml(a.phone||''),attendanceCall(a.phone)]),'No recorded attendance for these dates.'):
 table(['MEMBER','PHONE','LAST RECORDED PUNCH','CALL'],visible.map(m=>[person(m.member_name,m.admission_id),escapeHtml(m.phone||''),m.last_seen?`${simpleDate(m.last_seen)} ${time(m.last_seen)}`:'No record in loaded history',attendanceCall(m.phone)]),mode==='consecutive'&&!r.allCovered?'Refresh device history to verify seven consecutive days.':'No matching absent members.');
 return `<div class="stats-grid three">${stat('Recorded punches',fmt(r.attendance.length),'7', 'Seven completed days plus today')}${stat('Latest day absentees',group?.covered?fmt(group.absentees.length):'Not available','-',simpleDate(day))}${stat('Absent all 7 days',r.allCovered?fmt(r.consecutive.length):'Not available','7',`${simpleDate(r.from)} - ${simpleDate(r.to)}`)}</div>`+panel('Attendance and absentees',`Seven completed days: ${simpleDate(r.from)} - ${simpleDate(r.to)}. Today is available in attendance.`,controls+deviceWarning+coverage+summary+content+(rows.length>visible.length?'<button class="button" data-attendance-more>Show more members</button>':'')+`<p class="plain-note">Showing ${fmt(visible.length)} of ${fmt(rows.length)} matching records. Last device import: ${r.imported_at?simpleDate(r.imported_at)+' '+time(r.imported_at)+' IST':'Not imported'}. Daily absence checks confirmed active gym memberships on that date. Consecutive absence requires active membership on all seven days. Team Zenith, PT-only, archived and unmapped members are excluded from absentee lists. A biometric punch does not confirm door access.</p>`);
}
document.addEventListener('change',event=>{if(event.target.id==='attendanceDay'){state.attendanceDay=event.target.value;state.attendanceLimit=100;renderPage();}});
document.addEventListener('click',async event=>{
 if(event.target.closest('[data-attendance-more]')){state.attendanceLimit=(state.attendanceLimit||100)+100;renderPage();return;}
 const mode=event.target.closest('[data-attendance-mode]');if(mode){state.attendanceLimit=100;state.attendanceMode=mode.dataset.attendanceMode;state.attendanceDay=state.attendanceMode==='attendance'?'all':state.data.weeklyAttendance.to;renderPage();return;}
 const refresh=event.target.closest('[data-refresh-attendance]');if(!refresh)return;
 if(state.preview){toast('Device refresh requires your staff login.');return;}
 state.attendanceRefreshing=true;renderPage();
 try{const result=await api('attendance/refresh',{method:'POST',body:'{}'});toast(result.busy?'The fingerprint device is busy syncing. Try again shortly.':result.warning||`Attendance imported: ${result.records} punches.`);await loadDashboard();}
 catch(e){toast(e.message);}finally{state.attendanceRefreshing=false;renderPage();}
});
function renderSimpleOverview(d){
  const m=d.metrics;
  if(state.role==='trainer')return `<div class="stats-grid three">${stat('Assigned members',fmt(m.totalMembers),'♧','Your assigned members',true)}${stat('Present today',fmt(m.presentToday),'◷','Unique visits today')}${stat('Recorded visits',fmt(m.visits),'↗',`Last ${state.days} days`)}</div>${panel('Recent attendance','Assigned members only',table(['MEMBER','DATE','TIME','ACCESS'],attendanceRows(d.recentAttendance),'No attendance available'))}`;
  const g=d.gymOverview||{},r=d.reportRange||{from:d.today,to:d.today};
  const chosen=state.overviewRange||r;
  const update=(title,a,n,sub)=>`<article class="update-card"><h3>${title}</h3><div class="update-pair"><div><strong>${fmt(a)}</strong><span>Admissions</span></div><div><strong>${fmt(n)}</strong><span>Renewals</span></div></div><p>${sub}</p></article>`;
  return `${overviewSection('reportPeriod','Report period',`${simpleDate(r.from)} - ${simpleDate(r.to)}`,`<section class="overview-range"><div><h2>Report period</h2><p>Select dates to see admissions, renewals and collections.</p></div><div class="range-controls"><label>From<input id="overviewFrom" type="date" value="${escapeHtml(chosen.from)}" max="${d.today}"></label><label>To<input id="overviewTo" type="date" value="${escapeHtml(chosen.to)}" max="${d.today}"></label><button class="button dark" data-apply-range>Apply filter</button></div><div class="range-shortcuts"><button data-quick-range="today">Today</button><button data-quick-range="week">This week</button><button data-quick-range="month">This month</button></div></section>`)}<div class="selected-summary"><span>${simpleDate(r.from)} – ${simpleDate(r.to)}</span><span><strong>${fmt(g.selectedAdmissions)}</strong> admissions</span><span><strong>${fmt(g.selectedRenewals)}</strong> renewals</span></div>
    ${overviewSection('dailyUpdates','Daily updates',`As of ${simpleDate(g.asOf||d.today)}`,`<div class="updates-grid">${update(g.asOf===d.today?'Today’s updates':'Selected day',g.dailyAdmissions,g.dailyRenewals,simpleDate(g.asOf||d.today))}${update('Weekly updates',g.weeklyAdmissions,g.weeklyRenewals,`${simpleDate(g.weekStart)} – ${simpleDate(g.asOf)}`)}${update('Monthly updates',g.monthlyAdmissions,g.monthlyRenewals,`${simpleDate(g.monthStart)} – ${simpleDate(g.asOf)}`)}</div>`)}
    ${overviewSection('collections','Amount collected',`Selected report period · net of refunds`,`<div class="stats-grid three overview-money">${stat('Cash collected',rupees(g.cashCollected),'₹','Cash payments')}${stat('Online collected',rupees(g.onlineCollected),'↗','UPI, cards and bank payments')}${stat('Total amount collected',rupees(g.totalCollected),'₹',g.otherCollected?`${rupees(g.otherCollected)} has another or unknown method`:'Cash + online',true)}</div>`)}
    ${overviewSection('gymMembers','Gym members',`Membership status on ${simpleDate(g.asOf||d.today)}`,`<div class="stats-grid three overview-members">${stat('Active members',fmt(g.activeMembers),'●','Valid membership on this date')}${stat('Non-active members',fmt(g.inactiveMembers),'○','Expired or not yet active')}${stat('Total members',fmt(g.totalMembers),'♧','Excludes archived members')}</div>`)}
    ${state.role==='admin'?receptionActivitySection(d):''}
    <details class="overview-notes"><summary>About these numbers</summary><p>Weeks run Monday to the selected day. Monthly updates run from the 1st to the selected day. Historical records without a submission date use their membership start date. ${fmt(d.dataQuality?.heldPeriods||0)} historical periods are held for review.</p></details>`;
}
function managementRows(page){
  if(page==='review')return reviewRows();
  if(page==='pt')return (state.data.personalTraining||[]).filter(r=>activeFilters(r,{dateField:'start_date',categoryField:'trainer_name'}));
  const d=state.data;
  if(page==='sales')return(d.monthlySales||[]).filter(r=>activeFilters({...r,month_date:r.month+'-01'},{dateField:'month_date'}));
  if(page==='members')return d.members.filter(r=>activeFilters(r,{dateField:'created_at',statusField:'membership_status',categoryField:'category'}));
  if(['admissions','renewals','renewed'].includes(page)){
    const f=filtersForPage();
    if(page==='renewals'){
      const month=f.renewalMonth===undefined?d.today.slice(0,7):f.renewalMonth;
      return(d.renewalSchedule||[]).filter(r=>!month||r.expiry_month===month).filter(r=>activeFilters(r,{dateField:'end_date'}));
    }
    return(d.memberships||[]).filter(m=>m.kind===(page==='admissions'?'admission':'renewal')&&(page!=='renewed'||m.status==='confirmed')).map(m=>({...m,record_date:membershipRecordDate(m)})).filter(r=>activeFilters(r,{dateField:'record_date',planField:'plan_id',statusField:'status'})).sort((a,b)=>b.record_date.localeCompare(a.record_date));
  }
  if(page==='finance')return(d.allPayments||d.payments||[]).filter(r=>activeFilters(r,{dateField:'paid_at',methodField:'payment_mode',statusField:'kind'}));
  if(page==='pending')return pendingAmountRows(d).filter(r=>activeFilters(r,{dateField:'end_date',statusField:'balance_status'}));
  if(page==='leads')return leadManagerRows(d);
  if(page==='expenses')return(d.expenses||[]).filter(r=>activeFilters(r,{dateField:'expense_date',methodField:'payment_mode',statusField:'status',categoryField:'category'}));
  if(page==='enquiries')return(d.enquiries||[]).map(e=>({...e,effective_follow_up:leadFollowUp(e),lead_status:leadStatus(e)})).filter(r=>activeFilters(r,{dateField:'effective_follow_up',statusField:'lead_status',categoryField:'source'}));
  if(page==='team')return(d.staff||[]).filter(r=>activeFilters({...r,status:r.is_active?'Active':'Inactive'},{statusField:'status',categoryField:'role'}));
  return[];
}
function renderMonthlySales(d){
  const rows=managementRows('sales');const total=rows.reduce((s,r)=>s+r.collections,0);const exp=rows.reduce((s,r)=>s+r.expenses,0);
  return `<div class="stats-grid three">${stat('Collections',rupees(total),'₹','Matching months',true)}${stat('Recorded expenses',rupees(exp),'↘','Only expenses entered in this system')}${stat('Cash balance',rupees(total-exp),'↗','Collections minus recorded expenses')}</div><p class="plain-note">Cash balance is not net profit. Historical expenses are not included in the spreadsheet export. Admission and renewal counts are grouped by membership start date.</p>${panel('Month-wise sales','Collections are grouped by receipt date in IST.',filterBar({month:true})+table(['MONTH','COLLECTIONS','EXPENSES','CASH BALANCE','ADMISSIONS STARTED','RENEWALS STARTED'],rows.map(r=>[new Date(r.month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}),rupees(r.collections),rupees(r.expenses),rupees(r.cashBalance),fmt(r.admissions),fmt(r.renewals)]),'No collections for this selection'))}`;
}
function renderAdmissions(d){return renderMembershipPage(d,'admissions');}
function renderRenewals(d){return renderMembershipPage(d,'renewals');}
function renderRenewed(d){return renderMembershipPage(d,'renewed');}
function renderMembershipPage(d,page){
  const f=filtersForPage(),due=page==='renewals';const rows=managementRows(page);
  const selectedMonth=f.renewalMonth===undefined?d.today.slice(0,7):f.renewalMonth;
  const years=[...new Set([d.today.slice(0,4),...(d.renewalSchedule||[]).map(m=>m.expiry_month.slice(0,4))])].sort();
  const months=years.flatMap(y=>Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`));
  const monthControl=due?`<label class="renewal-month">Renewal month<select data-filter="renewalMonth"><option value="">All months</option>${months.map(m=>`<option value="${m}" ${m===selectedMonth?'selected':''}>${new Date(m+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</option>`).join('')}</select></label><p class="plain-note">Each member appears in their latest expiry month. Completed renewal transactions are in the Renewed tab.</p>`:'';
  const groupName=r=>packageOptions.find(p=>p.id===r.package_group)?.name||'Customize Packages';
  const title={admissions:'New member admissions',renewals:'Monthly renewals',renewed:'Renewed memberships'}[page];
  const subtitle=due?'Expiry reminders by calendar month.':page==='renewed'?'Confirmed renewals only. Date filters use the renewal submission date.':'Admission records only. Date filters use the admission submission date.';
  return panel(title,subtitle+' WhatsApp opens a prefilled message for you to review and send.',monthControl+filterBar({dates:!due,packages:true,statuses:page==='admissions'?['confirmed','cancelled']:[]})+table(due?['MEMBER','PHONE','PACKAGE','EXPIRY DATE','STATUS','WHATSAPP MESSAGE']:['MEMBER',page==='admissions'?'ADMITTED ON':'RENEWED ON','PACKAGE','START','END','CHARGE','ACCOUNTING','WHATSAPP MESSAGE'],rows.slice(0,200).map(r=>due?[person(r.member_name,r.admission_id),escapeHtml(r.phone||'Missing'),groupName(r),simpleDate(r.end_date),badge(r.end_date<d.today?'Expired':'Upcoming'),whatsappColumn(r,page)]:[person(r.member_name,r.admission_id),simpleDate(r.record_date),groupName(r),simpleDate(r.start_date),simpleDate(r.end_date),rupees(r.final_amount),badge(r.accounting_verified===false?'Needs review':'Verified'),whatsappColumn(r,page)]),'No matching membership records')+resultsFooter(rows.length),addButton(page==='admissions'?'admission':'renewal',page==='admissions'?'New admission':'Renew membership'));
}
function renderManagedMembers(d){const rows=managementRows('members');return panel('Member directory','Search names, phone numbers or admission IDs.',filterBar({dates:true,statuses:state.role==='trainer'?['Assigned']:['Active','Inactive','Upcoming','Archived'],categories:[...new Set(d.members.map(m=>m.category).filter(Boolean))]})+table(['MEMBER','PHONE','CATEGORY','STATUS','EXPIRY',...(state.role==='trainer'?[]:['MANAGE'])],rows.slice(0,200).map(m=>[person(m.full_name,m.admission_id),escapeHtml(m.phone||'Missing'),escapeHtml(m.category||'—'),badge(m.membership_status),simpleDate(m.expiry),...(state.role==='trainer'?[]:['<a href="/forms/update.html?member='+encodeURIComponent(m.admission_id)+'">Update member</a>'])]),'No matching members')+resultsFooter(rows.length));}
function renderManagedPayments(d){
  const rows=managementRows('finance');const total=rows.reduce((s,p)=>s+Number(p.amount)*(p.kind==='refund'?-1:1),0);
  return `<div class="stats-grid three">${stat('Filtered collections',rupees(total),'₹',`${fmt(rows.length)} matching entries`,true)}${stat('Confirmed dues',rupees(d.metrics.pending),'₹','Membership and PT balances')}${stat('Unreconciled periods',fmt(d.metrics.unreconciledPeriods),'!', 'Not included in confirmed dues')}</div><div class="left-column">${panel('Daily Cashbook','Daily receipts with membership descriptions. Opening balances are not counted again.',filterBar({dates:true,methods:[...new Set((d.allPayments||d.payments||[]).map(p=>p.payment_mode).filter(Boolean))],statuses:['payment','refund']})+table(['DATE','DESCRIPTION','TRANSACTION TYPE','AMOUNT','PAYMENT MODE'],rows.slice(0,200).map(p=>[simpleDate(p.paid_at),escapeHtml(p.description||p.member_name),escapeHtml(p.transaction_type||p.kind),rupees(Number(p.amount)*(p.kind==='refund'?-1:1)),escapeHtml(p.payment_mode||'Unknown')]),'No matching payments')+resultsFooter(rows.length),addButton('payment','Record payment'))}${panel('Outstanding balances','Only membership periods with verified opening payment information.',table(['MEMBER','PERIOD ENDS','OUTSTANDING'],(d.balances||[]).slice(0,100).map(m=>[person(m.member_name,m.admission_id),simpleDate(m.end_date),rupees(m.outstanding)]),'No confirmed dues'))}</div>`;
}
function renderExpenses(d){const rows=managementRows('expenses');return panel('Expense register','Voided entries remain in the history but are excluded from totals.',filterBar({dates:true,statuses:['recorded','void'],methods:['Cash','UPI','Bank transfer','Card'],categories:['Rent','Salary','Utilities','Equipment','Maintenance','Marketing','Other']})+table(['DATE','CATEGORY','DESCRIPTION','AMOUNT','METHOD','STATUS','ACTION'],rows.slice(0,200).map(e=>[simpleDate(e.expense_date),escapeHtml(e.category),escapeHtml(e.description),rupees(e.amount),escapeHtml(e.payment_mode),badge(e.status),e.status==='recorded'&&state.role==='admin'?`<button class="row-action danger" data-void-expense="${escapeHtml(e.id)}">Void</button>`:'—']),'No expenses entered')+resultsFooter(rows.length),addButton('expense','Add expense'));}
function renderManagedStaff(d){const rows=managementRows('team');return panel('Staff and access','Remove disables gym access and preserves payment and audit history.',filterBar({statuses:['Active','Inactive'],categories:['admin','receptionist','trainer']})+table(['STAFF','ROLE','ACCESS','ACTIONS'],rows.map(s=>[person(s.full_name),roleLabel(s.role),badge(s.is_active?'Active':'Inactive'),`<div class="row-actions"><button class="row-action" data-edit-staff="${escapeHtml(s.id)}">Edit</button><button class="row-action ${s.is_active?'danger':''}" data-staff-access="${escapeHtml(s.id)}" data-active="${s.is_active?'false':'true'}">${s.is_active?'Remove access':'Restore access'}</button></div>`]),'No matching staff'),addButton('staff','Add staff'));}
function renderManagedEnquiries(d){return renderEnquiryRegister(d);}

function field(name,label,{type='text',value='',options,required=true,wide=false}={}){return `<label class="form-field ${wide?'wide':''}">${label}${options?`<select name="${name}" ${required?'required':''}>${options.map(o=>{const v=typeof o==='string'?o:o.id;const text=typeof o==='string'?o:o.name;return `<option value="${escapeHtml(v)}" ${String(value)===String(v)?'selected':''}>${escapeHtml(text)}</option>`;}).join('')}</select>`:`<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${type==='number'?'min="0" step="0.01"':type==='password'?'minlength="8" autocomplete="new-password"':''} ${required?'required':''}>`}</label>`;}
function openEntry(kind,id){
  if(state.data?.source?.readOnly){toast('Run the prepared Supabase setup query to enable saving. This snapshot is read-only.');return;}
  state.entry={kind,id,requestId:crypto.randomUUID()};const d=state.data;const today=d.today;const memberOptions=d.members.filter(m=>!m.is_archived).map(m=>({id:m.id,name:`${m.admission_id} · ${m.full_name}`}));let fields='';
  const planOptions=(d.plans||[]).map(p=>({id:p.id,name:p.name}));
  if(['admission','renewal'].includes(kind)){
    fields='<p class="form-hint wide">Saved directly to Supabase. Google Sheets and device updates are queued separately; they do not delay the database save.</p>'+(kind==='admission'?field('full_name','Full name')+field('phone','Phone number',{type:'tel'})+field('category','Category',{options:['General fitness','Personal training','Happy hours','Zumba']}):field('member_id','Member',{options:memberOptions,wide:true}))+field('plan_id','Membership plan',{options:planOptions})+field('start_date','Start date',{type:'date',value:today})+field('end_date','End date',{type:'date'})+field('total_amount','Package amount (₹)',{type:'number'})+field('discount_amount','Discount (₹)',{type:'number',value:0})+field('paid_amount','Paid now (₹)',{type:'number',value:0})+field('payment_mode','Payment method',{options:['Cash','UPI','Bank transfer','Card']});
  }else if(kind==='payment')fields=field('membership_id','Membership / outstanding balance',{wide:true,value:id||'',options:[...(d.balances||[]),...(d.legacyPTBalances||[])].map(m=>({id:m.id,name:`${m.admission_id} · ${m.member_name} · ${rupees(m.outstanding)}`}))})+field('amount','Amount (₹)',{type:'number'})+field('payment_mode','Method',{options:['Cash','UPI','Bank transfer','Card']});
  else if(kind==='pt-payment'){const c=(d.personalTraining||[]).find(c=>c.id===id);fields='<p class="form-hint wide">'+escapeHtml(c.member_name)+' | '+escapeHtml(c.trainer_name)+' | '+rupees(c.outstanding)+' due</p>'+field('amount','Amount received (INR)',{type:'number'})+field('payment_mode','Payment method',{options:['Cash','UPI','Card','Bank Transfer']});}
  else if(kind==='review'){const r=d.reviewMembers.find(r=>r.id===id);state.entry.reviewVersion=r.review_updated_at;fields=reviewEntryFields(r);}
  else if(kind==='expense')fields=field('expense_date','Date',{type:'date',value:today})+field('category','Category',{options:['Rent','Salary','Utilities','Equipment','Maintenance','Marketing','Other']})+field('description','Description',{wide:true})+field('amount','Amount (₹)',{type:'number'})+field('payment_mode','Method',{options:['Cash','UPI','Bank transfer','Card']});
  else if(kind==='staff'||kind==='staff-edit'){
    const staff=(d.staff||[]).find(s=>s.id===id)||{};
    fields=field('full_name','Staff name',{value:staff.full_name||''})+field('role','Role',{value:staff.role||'receptionist',options:['admin','receptionist','trainer']})+(kind==='staff'?field('login','Email address or contact number',{wide:true})+field('password','Password (at least 8 characters)',{type:'password',wide:true})+'<p class="form-hint wide">Create a staff login with access for the selected role.</p>':'');
  }else if(kind==='enquiry')fields=field('full_name','Name')+field('phone','Phone',{type:'tel'})+field('email','Email',{type:'email',required:false})+field('address','Address',{required:false})+field('interested_plan','Interested in',{options:['Gym','Zumba','Personal Training','Happy Hours','Other']})+field('source','Source',{options:['Walk-in','Referral','Instagram','Google','Other']})+field('follow_up_date','Follow-up date',{type:'date',value:today,required:false})+field('notes','Message / requirements',{wide:true,required:false});
  else if(kind==='enquiry-edit'){const e=d.enquiries.find(e=>e.id===id);fields=field('lead_status','Status',{value:leadStatus(e),options:LEAD_STATUSES})+field('next_follow_up_date','Next follow-up date',{type:'date',value:leadFollowUp(e)||'',required:false})+'<label class="form-field wide">Conversation remark<textarea name="remark" rows="4">'+escapeHtml(e.remark||'')+'</textarea></label>';}
  $('#saveEntry').hidden=false;
  $('#entryTitle').textContent=({review:'Update member follow-up','pt-payment':'Collect PT payment',admission:'New admission',renewal:'Renew membership',payment:'Record payment',expense:'Add expense',staff:'Add staff','staff-edit':'Edit staff',enquiry:'New enquiry','enquiry-edit':'Update enquiry'})[kind];
  $('#entryFields').innerHTML=fields;$('#entryError').textContent='';$('#entryDialog').showModal();
  if(kind==='review')setupReviewRules();
}
async function saveManagementEntry(event){event.preventDefault();if(state.preview){toast('Design preview: changes are not saved.');$('#entryDialog').close();return;}
  let values=Object.fromEntries(new FormData($('#entryForm')));const {kind,id}=state.entry;let endpoint,method='POST';
  if(['admission','renewal'].includes(kind)){endpoint='memberships';values.kind=kind;values.requestId=state.entry.requestId;}
  else if(kind==='pt-payment'){const c=state.data.personalTraining.find(c=>c.id===id);endpoint='member-command';values={requestId:state.entry.requestId,command:'pt_payment',payload:{...values,contract_id:id,member_id:c.member_id}};}else if(kind==='review'){endpoint='member-reviews';values.membership_id=id;values.requestId=state.entry.requestId;values.expected_updated_at=state.entry.reviewVersion;}else if(kind==='payment')endpoint='payments';else if(kind==='expense')endpoint='expenses';else if(kind==='staff')endpoint='staff';else if(kind==='staff-edit'){endpoint=`staff/${id}`;method='PATCH';}else if(kind==='enquiry'){endpoint='enquiries';values.requestId=state.entry.requestId;}else{endpoint=`enquiries/${id}`;method='PATCH';}
  $('#saveEntry').disabled=true;$('#entryError').textContent='';
  try{await api(endpoint,{method,body:JSON.stringify(values)});$('#entryDialog').close();toast('Saved to Supabase.');await loadDashboard();}catch(error){$('#entryError').textContent=error.message;}finally{$('#saveEntry').disabled=false;}
}
async function changeRecord(endpoint,method,body){if(state.data?.source?.readOnly){toast('Complete Supabase setup before changing records.');return;}if(state.preview){toast('Design preview: changes are not saved.');return;}try{await api(endpoint,{method,body:JSON.stringify(body||{})});toast('Record updated.');await loadDashboard();}catch(e){toast(e.message);}}
function exportManagementReport(){if(state.role==='receptionist'){toast('Report export is not available for reception.');return;}const rows=managementRows(state.page).map(row=>{if(['admissions','renewals','renewed'].includes(state.page)){const wa=membershipWhatsApp(row,state.page);return {...row,whatsapp_message:wa.message,whatsapp_url:wa.url||''};}return row;});if(!rows.length){toast('No matching records to export.');return;}const scalarRows=rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>(v===null||typeof v!=='object')&&k!=='user_id')));const headers=[...new Set(scalarRows.flatMap(r=>Object.keys(r)))];const cell=v=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;const csv='\uFEFF'+[headers.map(cell).join(','),...scalarRows.map(r=>headers.map(h=>cell(r[h])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`zenith-${state.preview?'sample-':''}${state.page}-${state.data.today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${rows.length} matching records exported.`);}

document.addEventListener('change',event=>{const key=event.target.dataset?.filter;if(key){filtersForPage()[key]=event.target.value;renderPage();}});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-clear-filters')){state.filters[state.page]={};state.search='';renderPage();}
  if(target.dataset.renewalView){state.filters[state.page]={view:target.dataset.renewalView};renderPage();}
  if(target.dataset.add)openEntry(target.dataset.add);
  if(target.dataset.editStaff)openEntry('staff-edit',target.dataset.editStaff);
  if(target.dataset.editEnquiry)openEntry('enquiry-edit',target.dataset.editEnquiry);
  if(target.dataset.staffAccess&&window.confirm(`${target.dataset.active==='true'?'Restore':'Remove'} this person’s gym access?`))changeRecord(`staff/${target.dataset.staffAccess}`,target.dataset.active==='true'?'PATCH':'DELETE',{is_active:target.dataset.active==='true'});
  if(target.dataset.voidExpense&&window.confirm('Void this expense? It will stay in the history and be excluded from totals.'))changeRecord(`expenses/${target.dataset.voidExpense}`,'DELETE');
  if(target.hasAttribute('data-import-snapshot'))importRealSnapshot(target);
  if(target.hasAttribute('data-apply-range')){
    const from=$('#overviewFrom').value,to=$('#overviewTo').value;
    if(!from||!to||from>to||to>state.data.today){toast('Choose valid dates, ending today or earlier.');return;}
    state.overviewRange={from,to};loadDashboard();
  }
  if(target.dataset.quickRange){
    const to=state.data.today;let from=to;
    if(target.dataset.quickRange==='month')from=to.slice(0,7)+'-01';
    if(target.dataset.quickRange==='week'){const d=new Date(to+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));from=d.toISOString().slice(0,10);}
    state.overviewRange={from,to};loadDashboard();
  }
});
async function importRealSnapshot(button){
  button.disabled=true;button.textContent='Importing records…';
  try{const result=await api('import-snapshot',{method:'POST',body:'{}'});toast(`Imported ${result.members} members and ${result.membership_periods} membership periods.`);await loadDashboard();}
  catch(error){toast(error.message);button.disabled=false;button.textContent='Import real data into Supabase';}
}
document.addEventListener('DOMContentLoaded',()=>{
  $('#entryForm').addEventListener('submit',saveManagementEntry);
  $('#entryDialog').addEventListener('close',()=>{const password=$('#entryForm').querySelector('input[name="password"]');if(password)password.value='';});
  $('#closeDialog').addEventListener('click',()=>$('#entryDialog').close());$('#cancelDialog').addEventListener('click',()=>$('#entryDialog').close());
});
