const $ = selector => document.querySelector(selector);
const state = { preview: new URLSearchParams(location.search).has('preview'), role: new URLSearchParams(location.search).get('preview') || 'admin', page: new URLSearchParams(location.search).get('page') || 'overview', days: 30, data: null, search: '', filter: 'all', busy: false, generation: 0 };
const initialReportDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
state.overviewRange={from:initialReportDay,to:initialReportDay};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const countFormat=new Intl.NumberFormat('en-IN',{maximumFractionDigits:0});
const moneyFormat=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2});
const shortDateFormat=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'});
const timeFormat=new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
const fmt = n => countFormat.format(Number(n||0));
const rupees = n => moneyFormat.format(Number(n||0));
const date = value => value ? shortDateFormat.format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value)) : '—';
const time = value => timeFormat.format(new Date(value));
const initials = name => String(name || '').trim().split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
const icons = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  members:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3M16 5a3 3 0 010 6M21 21v-3a6 6 0 00-3-5"/>',
  attendance:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-12 5 3 3 5-5"/>',
  finance:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-5 5h2"/>',
  enquiries:'<path d="M21 11a8 8 0 01-8 8H5l-3 3V11a9 9 0 0118-4M7 11h10M7 15h6"/>',
  team:'<circle cx="12" cy="8" r="3"/><path d="M6 21v-3a6 6 0 0112 0v3M3 5v5m-2-2h4m16-3v5m-2-2h4"/>',
  operations:'<path d="m3 12 4-7 5 14 5-14 4 7"/>',
};
function icon(name) { return `<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.overview}</svg></span>`; }
const navs = { overview:'Overview', finance:'Daily Cashbook', admissions:'Admissions', renewed:'Renewed Members', renewals:'Renewals', pt:'Personal Training', enquiries:'Enquiries', leads:'Follow-ups', messages:'WhatsApp Messages', fingerprint:'Fingerprint Sync', attendance:'Attendance', review:'Review Members', members:'Members', pending:'Pending Amounts', expenses:'Expenses', sales:'Monthly sales', team:'Staff', operations:'Activity & sync', parameters:'Membership Parameters' };
const roleLabel = role => ({ admin:'Administrator', receptionist:'Receptionist', trainer:'Trainer' })[role] || 'Staff';
async function api(path, options = {}) {
  const response = await fetch(`/api/portal/${path}`, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to load your workspace.'), { status:response.status });
  return data.queued&&data.jobId?window.zenithAwaitBridge(data.jobId):data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500); }
function empty(title, text = 'Records will appear here when they are added to your workspace.') { return `<div class="empty"><span class="empty-icon">↗</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`; }
function badge(label) { const lower = String(label).toLowerCase(); const style = ['active','allowed','completed','confirmed'].includes(lower) ? '' : ['new','upcoming','pending','processing','contacted'].includes(lower) ? 'amber' : ['restricted','failed','inactive','cancelled'].includes(lower) ? 'red' : 'gray'; return `<span class="badge ${style}">${escapeHtml(label)}</span>`; }
function person(name, subtitle = '') { return `<div class="person"><span class="avatar">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div></div>`; }
function stat(label, value, symbol, foot, highlight = false) { return `<article class="stat-card ${highlight?'highlight':''}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${symbol}</span></div><div class="stat-value">${value}</div><div class="stat-bottom">${foot}</div></article>`; }
function table(headers, rows, emptyTitle = 'Nothing here just yet') { return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td data-label="${escapeHtml(headers[i])}"><div class="table-cell-value">${c}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty(emptyTitle); }
function panel(title, subtitle, content, action = '', extra = '') { return `<section class="panel ${extra}"><div class="panel-heading"><div><h2>${title}</h2><p class="panel-subtitle">${subtitle}</p></div>${action}</div>${content}</section>`; }
function goButton(page, label) { return `<button class="panel-link" data-go="${page}">${label} ↗</button>`; }
function renderNav() {
  const available = state.role === 'admin' ? Object.keys(navs) : state.role === 'receptionist' ? ['admissions','renewed','renewals','pt','enquiries','leads','attendance','review','members','pending','expenses'] : ['overview','members','attendance'];
  if (!available.includes(state.page)) state.page = available[0];
  $('#mainNav').innerHTML = available.map(key=>`<button class="nav-item ${state.page === key?'active':''}" data-go="${key}" ${state.page===key?'aria-current="page"':''}>${icon(key)}<span>${key==='members'&&state.role==='trainer'?'My members':navs[key]}</span>${key==='members' && state.data ? `<span class="nav-count">${fmt(state.data.metrics.totalMembers)}</span>` : ''}</button>`).join('');
}
function renderShell() {
  $('#exportButton').hidden=state.role==='receptionist';$('#exportButton').disabled=state.role==='receptionist';
  $('#loginScreen').hidden = true; $('#workspace').hidden = false;
  $('#previewBanner').hidden = !state.preview;
  $('#previewRole').value = state.role;
  const name = state.data?.currentStaff?.full_name || 'Zenith staff';
  $('#userName').textContent = name; $('#userRole').textContent = roleLabel(state.role);
  $('#userInitials').textContent = initials(name); $('#headerInitials').textContent = initials(name);
  $('#headerDate').textContent = new Date().toLocaleDateString('en-IN',{ weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata' });
  $('#connectionText').textContent = state.preview ? 'Sample workspace' : state.data?.source?.type==='spreadsheet_snapshot'?'Real spreadsheet data':'Supabase connected';
  $('#profileButton').title = state.preview ? 'Exit preview' : 'Sign out';
  renderNav();
}
function trend(current, previous) { if (!previous) return '<span>No previous-period comparison yet</span>'; const change=(current-previous)/Math.abs(previous)*100; return `<span class="trend ${change<0?'negative':''}">${change<0?'↘':'↗'} ${Math.abs(change).toFixed(1)}%</span><span>vs. previous ${state.days} days</span>`; }
function chart(series, key) {
  const values = series.map(p=>Number(p[key]||0));
  const max = Math.max(...values, 1) * 1.18;
  const min = Math.min(...values, 0) * 1.18;
  const w=640,h=172,left=46,right=17,top=10,bottom=28;
  const x=i=>left+i*(w-left-right)/Math.max(1,values.length-1);
  const y=v=>h-bottom-(v-min)/(max-min)*(h-bottom-top);
  const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
  const grid=Array.from({length:4},(_,i)=>{const val=min+(max-min)*i/3;return `<line x1="${left}" x2="${w-right}" y1="${y(val)}" y2="${y(val)}" stroke="#edf0f1" stroke-dasharray="3 4"/><text x="${left-9}" y="${y(val)+3}" text-anchor="end">${key==='revenue'?(Math.abs(val)>=1000?`${Math.round(val/1000)}k`:Math.round(val)):Math.round(val)}</text>`;}).join('');
  const labels=[0,Math.floor((values.length-1)/4),Math.floor((values.length-1)/2),Math.floor((values.length-1)*3/4),values.length-1].map(i=>`<text x="${x(i)}" y="${h-6}" text-anchor="middle">${date(series[i].date)}</text>`).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily ${key} over the last ${state.days} days"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b5cc87" stop-opacity=".26"/><stop offset="1" stop-color="#b5cc87" stop-opacity=".015"/></linearGradient></defs>${grid}<polygon points="${left},${y(0)} ${points} ${w-right},${y(0)}" fill="url(#chartFill)"/><polyline points="${points}" fill="none" stroke="#99b56b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${labels}</svg></div>`;
}
function planDonut(d) {
  const colors=['#a5be7b','#d4e3bd','#dce3e9','#e8e9ed']; const plans=d.planMix||[]; const total=plans.reduce((a,p)=>a+p.count,0); let offset=0;
  const stops=plans.map((p,i)=>{const start=offset;offset+=total?p.count/total*100:0;return `${colors[i%4]} ${start}% ${offset}%`;});
  return `<div class="donut-layout"><div class="donut" style="background:${total?`conic-gradient(${stops.join(',')})`:'#eef1ec'}"><div class="donut-center"><strong>${fmt(total)}</strong><small>active members</small></div></div></div><div class="donut-key">${plans.map((p,i)=>`<div><i style="background:${colors[i%4]}"></i>${escapeHtml(p.name)}<strong>${fmt(p.count)}</strong></div>`).join('')}</div>`;
}
function attentionItem(symbol, title, sub, page, style='') { return `<button class="attention-item" data-go="${page}" style="text-align:left;padding:0;width:100%"><span class="attention-symbol ${style}">${symbol}</span><span><strong>${title}</strong><small>${sub}</small></span><span>›</span></button>`; }
function attendanceRows(rows, short=false) { return rows.map(a=>[person(a.member_name,a.admission_id),...(short?[]:[date(a.punched_at)]),time(a.punched_at),badge(a.access_result === 'allowed'?'Allowed':a.access_result === 'restricted'?'Restricted':'Unverified')]); }
function renderOverview(d) {
  const m=d.metrics, trainer=state.role==='trainer';
  const stats=trainer ? stat('Assigned members',fmt(m.totalMembers),'♧','Your current member list',true)+stat('Present today',fmt(m.presentToday),'◷','Unique members with a recorded visit')+stat('Punches this period',fmt(m.visits),'↗',`Last ${state.days} days`) : stat('Net collections',rupees(m.revenue),'₹',trend(m.revenue,m.previousRevenue),true)+stat('Active members',fmt(m.activeMembers),'♧',`<span>${fmt(m.totalMembers)} total members</span>`)+stat('Present today',fmt(m.presentToday),'◷','Unique members with a recorded visit')+stat('Renewals due',fmt(m.renewalDue),'↗','Today through the next 7 days');
  const key=trainer?'visits':'revenue';
  const mainChart=panel(trainer?'Attendance at a glance':'The progress behind the numbers',trainer?'Daily unique visits for your assigned members':'Net collections · payments less refunds',`<div class="chart-value"><strong>${trainer?fmt(d.series.reduce((s,p)=>s+p.visits,0)):rupees(m.revenue)}</strong><span>over the last ${state.days} days</span></div>${chart(d.series,key)}<div class="chart-summary">${trainer?`<div>ASSIGNED MEMBERS<strong>${fmt(m.totalMembers)}</strong></div><div>PRESENT TODAY<strong>${fmt(m.presentToday)}</strong></div>`:`<div>NEW MEMBERS<strong>${fmt(m.newMembers)}</strong></div><div>OUTSTANDING DUES<strong>${rupees(m.pending)}</strong></div><div>TOTAL PUNCHES<strong>${fmt(m.visits)}</strong></div>`}</div>`,`<span class="chart-legend"><i></i>${trainer?'Visits':'Collections'}</span>`);
  const activity=panel('A little movement. A lot of consistency.','Recent attendance in the selected period',table(['MEMBER','CHECK-IN','ACCESS'],attendanceRows(d.recentAttendance,true),'Your first check-in starts here')+`<div class="table-bottom"><span>Latest ${d.recentAttendance.length} records</span><span>Times shown in IST</span></div>`,goButton('attendance','View attendance'));
  const due=d.renewals||[];
  const right=trainer ? panel('Your daily focus','A simple view of the people you support',`<div class="attention-list">${attentionItem('♧',`${fmt(m.totalMembers)} assigned members`,'Check in on your member list.','members','green')}${attentionItem('◷',`${fmt(m.presentToday)} present today`,'Keep an eye on consistency.','attendance','blue')}</div>`) : panel('Membership mix','A balanced view of active plans',planDonut(d))+panel('Worth your attention','Small follow-ups. Meaningful progress.',`<div class="attention-list">${attentionItem('↗',`${fmt(m.renewalDue)} renewals coming up`,'Memberships ending within 7 days.','members')}${attentionItem('₹',`${rupees(m.pending)} to follow up`,'Outstanding across confirmed periods.','finance','green')}${attentionItem('☷',`${fmt((d.enquiries||[]).filter(q=>q.status==='new').length)} fresh conversations`,'New enquiries waiting for a hello.','enquiries','blue')}</div>`);
  const focus=`<section class="panel focus-panel"><div class="focus-top"><span>THE NEXT SMALL STEP</span><span>↗</span></div><h3>${trainer?'Consistency starts<br>with a conversation.':'A follow-up today.<br>A stronger tomorrow.'}</h3><p>${trainer?'Make time for the members who haven’t checked in. A little attention can go a long way.':due.length?`${fmt(due.length)} members are approaching renewal. A timely conversation can keep their progress going.`:'Build the habit of a daily review. Your next opportunity starts with the details.'}</p><button class="button full" data-go="members">${trainer?'See your members':'Explore your member list'} <span>↗</span></button></section>`;
  return `<div class="stats-grid ${trainer?'three':''}">${stats}</div><div class="dashboard-grid"><div class="left-column">${mainChart}${activity}</div><div class="right-column">${right}${focus}</div></div>`;
}
function toolbar(placeholder, filters=[]) { return `<div class="toolbar"><label class="search-box"><span>⌕</span><input id="tableSearch" type="search" placeholder="${placeholder}" aria-label="${placeholder}" value="${escapeHtml(state.search)}"></label>${filters.length?`<select id="tableFilter" class="filter-select" aria-label="Filter records"><option value="all">All records</option>${filters.map(f=>`<option value="${f}" ${state.filter===f?'selected':''}>${f}</option>`).join('')}</select>`:''}</div>`; }
function matched(row) { return Object.values(row).some(value=>String(value??'').toLowerCase().includes(state.search.toLowerCase())); }
function renderMembers(d) {
  const members=d.members.filter(m=>matched(m)&&(state.filter==='all'||m.membership_status===state.filter));
  return panel(state.role==='trainer'?'Your people. Their progress.':'Every member, in one place.',`${fmt(d.metrics.totalMembers)} members · searchable by name, admission ID, or phone`,toolbar('Search members, ID, or phone…',state.role==='trainer'?[]:['Active','Inactive','Upcoming','Archived'])+table(['MEMBER','PHONE','CATEGORY','STATUS',...(state.role==='trainer'?[]:['VALID UNTIL'])],members.slice(0,100).map(m=>[person(m.full_name,m.admission_id),escapeHtml(m.phone||'—'),escapeHtml(m.category||'—'),badge(m.membership_status),...(state.role==='trainer'?[]:[date(m.expiry)])]),'No matching members')+`<div class="table-bottom"><span>Showing ${Math.min(100,members.length)} of ${fmt(members.length)} matching members</span><span>Export for the full list</span></div>`);
}
function renderAttendance(d) {
  if(d.weeklyAttendance&&state.role!=='trainer')return renderWeeklyAttendance(d);
  const rows=d.attendance.filter(a=>matched(a)&&(state.filter==='all'||a.access_result===state.filter));
  return panel('Every visit tells a story.',`Recorded device events · last ${state.days} days · IST`,toolbar('Search name, admission ID, or time…',['allowed','restricted','unknown'])+table(['MEMBER','DATE','CHECK-IN','ACCESS'],attendanceRows(rows),'No check-ins recorded')+`<div class="table-bottom"><span>Latest ${rows.length} matching events; maximum 100 loaded</span><span>Unverified events do not confirm door access</span></div>`);
}
function renderFinance(d) {
  const m=d.metrics;
  return `<div class="stats-grid three">${stat('Net collections',rupees(m.revenue),'₹',trend(m.revenue,m.previousRevenue),true)}${stat('Outstanding dues',rupees(m.pending),'↗','All confirmed membership periods')}${stat('Recorded transactions',fmt(d.payments.length),'☷',`Last ${state.days} days`)}</div><div class="left-column">${panel('A clear view of what’s due.','Balances calculated from membership charges and recorded payments',table(['MEMBER','VALID UNTIL','OUTSTANDING'],d.balances.slice(0,50).map(b=>[person(b.member_name,b.admission_id),date(b.end_date),rupees(b.outstanding)]),'No outstanding balances'))}${panel('Payments, clearly recorded.','Payments and refunds in the selected period',toolbar('Search payments…')+table(['MEMBER','DATE','METHOD','TYPE','AMOUNT'],d.payments.filter(matched).slice(0,100).map(p=>[person(p.member_name),date(p.paid_at),escapeHtml(p.payment_mode),badge(p.kind),rupees(p.amount)]),'No payments recorded'))}</div>`;
}
function renderEnquiries(d) { return panel('Good conversations start here.','Follow-ups and enquiries for your gym',toolbar('Search enquiries…',['new','contacted','converted','closed'])+table(['NAME','PHONE','INTERESTED IN','FOLLOW-UP','STATUS'],d.enquiries.filter(q=>matched(q)&&(state.filter==='all'||q.status===state.filter)).map(q=>[person(q.full_name),escapeHtml(q.phone),escapeHtml(q.interested_plan||'—'),date(q.follow_up_date),badge(q.status)]),'Your next conversation is ahead')); }
function renderTeam(d) { return `<div class="section-note">Staff roles control access to gym data. Accounts and role assignments are currently managed in Supabase.</div><div class="three-grid">${d.staff.map(s=>`<article class="staff-card"><span class="avatar">${escapeHtml(initials(s.full_name))}</span><h3>${escapeHtml(s.full_name)}</h3><p>${roleLabel(s.role)}</p>${badge(s.is_active?'Active':'Inactive')}</article>`).join('')}</div>`; }
function renderFingerprintPage(){return '<iframe class="fingerprint-frame" src="/fingerprint/?embedded=1" title="Fingerprint Sync"></iframe>';}
function renderOperations(d) { return `<section class="panel" style="padding:22px;margin-bottom:20px"><h2>Membership access sync</h2><p><button class="button" data-private-forms-link>Private staff link for forms</button></p><p class="plain-note">Select today or tomorrow. Sync applies that date's access rules to the fingerprint device immediately. Team Zenith IDs remain unchanged.</p><div class="range-controls"><label>Access date<input type="date" id="accessSyncDate" value="${state.deviceSyncDate||d.today}" min="${d.today}" max="${new Date(new Date(d.today+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10)}"></label><button class="button" data-access-day="today">Today</button><button class="button" data-access-day="tomorrow">Tomorrow</button><button class="button" data-date-preview>Preview selected date</button><button class="button dark" data-device-date-sync>Sync memberships for selected date</button></div><p id="dateSyncStatus" role="status" class="plain-note"></p></section><div class="section-note">Supabase assigns member IDs and controls access. The six-tab workbook is a fallback projection. Sync runs while this local app has an active admin or receptionist session. Enquiries and attendance remain in Supabase and are not part of these six tabs.</div><div class="heading-actions" style="margin-bottom:20px"><button class="button" data-sync-preview>Preview sync &amp; settings</button><button class="button dark" data-secondary-sync="google_sheets">Sync fallback workbook</button><button class="button dark" data-secondary-sync="fingerprint">Sync fingerprint batch</button></div><div class="left-column">${panel('Every handoff, accounted for.','Latest 20 sync jobs recorded in Supabase',table(['DESTINATION','EVENT','STATUS','ATTEMPTS','CREATED'],d.syncJobs.map(j=>[escapeHtml(j.destination),escapeHtml(j.event_type),badge(j.status),fmt(j.attempts),date(j.created_at)]),'No sync jobs recorded'))}${panel('A record of the details.','Latest 20 audit events recorded in Supabase',table(['ACTION','RECORD TYPE','DATE','TIME'],d.auditLogs.map(a=>[escapeHtml(a.action),escapeHtml(a.entity_type),date(a.created_at),time(a.created_at)]),'No audit events recorded'))}</div>`; }
function renderPage() {
  ZenithMessages.setTemplates(state.data?.whatsappTemplates);
  renderNav();
  const descriptions={ overview:['YOUR GYM, AT A GLANCE','A little clarity. A lot of progress.',`Here’s what’s happening at Zenith Fitness${state.role==='trainer'?' with your assigned members':''}.`], members:['PEOPLE FIRST',state.role==='trainer'?'Your members. Their next milestone.':'The people behind the progress.','A clear view of every membership, one person at a time.'], attendance:['SHOWING UP MATTERS','Consistency, in the details.','A closer look at the visits that build better habits.'], finance:['YOUR NUMBERS, IN FOCUS','Healthy numbers. Stronger decisions.','Collections, payment history, and the balances worth following up.'], enquiries:['ROOM TO GROW','The next hello starts here.','Keep every conversation and follow-up in focus.'], team:['BETTER, TOGETHER','The people moving Zenith forward.','A shared purpose. The right access for every role.'], operations:['BEHIND THE SCENES','The details that keep things moving.','A clear record of activity and data handoffs.'] };
  Object.assign(descriptions,{overview:['GYM MANAGEMENT','Overview','Members, collections and the follow-ups that need attention.'],sales:['REPORTS','Monthly sales','Collections by month, recorded expenses and cash balance.'],admissions:['MEMBERSHIPS','Admissions','New member admissions and their membership details.'],renewals:['MEMBERSHIPS','Renewals','Memberships due for renewal, grouped by their latest expiry month.'],renewed:['MEMBERSHIPS','Renewed Members','Confirmed renewal transactions and renewed membership periods.'],expenses:['FINANCE','Expenses','Track rent, salaries, utilities, maintenance and other costs.'],team:['PEOPLE','Staff','Add staff, manage roles and remove gym access.'],members:['PEOPLE','Members','Search and filter your member directory.'],finance:['FINANCE','Daily Cashbook','Daily receipts, payment methods and collection descriptions.'],enquiries:['LEADS','Enquiries','New leads, follow-up dates and conversion status.'],attendance:['CHECK-INS','Attendance','Recorded visits and access events.']});
  Object.assign(descriptions,{parameters:['MEMBER INSIGHTS','Membership Parameters','Gender, renewal and locality charts with member status and period filters.'],review:['MEMBER RETENTION','Review Members','Follow up expired members and record their plans to return.'],messages:['COMMUNICATION','WhatsApp Messages','Edit and preview all shared prefilled messages.'],fingerprint:['DEVICE ACCESS','Fingerprint Sync','Sync Supabase membership access for today or tomorrow.'],pt:['COACHING','Personal Training','Training packages, trainer assignments and PT payments.'],pending:['FINANCE','Pending Amounts','Confirmed outstanding balances and historical records needing reconciliation.'],leads:['LEAD MANAGER','Follow-ups','Your gym lead manager, with calls, WhatsApp, next dates and remarks.']});
  const [eyebrow,title,description]=descriptions[state.page];
  $('#breadcrumbPage').textContent=navs[state.page]; $('#pageEyebrow').textContent=eyebrow; $('#pageTitle').textContent=title; $('#pageDescription').textContent=description;
  $('.period-control').hidden=state.page!=='attendance';
  const renderers={ parameters:renderParametersPage,overview:renderSimpleOverview,sales:renderMonthlySales,admissions:renderAdmissions,renewals:renderRenewals,renewed:renderRenewed,review:renderReviewMembers,pt:renderPersonalTraining,members:renderManagedMembers,attendance:renderAttendance,finance:renderManagedPayments,pending:renderPendingAmounts,leads:renderLeadManager,expenses:renderExpenses,enquiries:renderManagedEnquiries,team:renderManagedStaff,fingerprint:renderFingerprintPage,messages:renderMessages,operations:renderOperations };
  // Preserve an in-progress device sync during the dashboard's timed refresh.
  if(state.page!=='fingerprint'||!$('#pageBody').querySelector?.('.fingerprint-frame'))$('#pageBody').innerHTML=renderers[state.page](state.data);
  $('#freshness').textContent=state.preview?'Sample data · design preview':state.data.source?.type==='spreadsheet_snapshot'?`Real spreadsheet snapshot · exported ${state.data.source.exportDate}`:`Updated ${time(state.data.generatedAt)} IST · refreshes every minute`;
  const source=state.data.source;$('#sourceBanner').hidden=state.preview||source?.type!=='spreadsheet_snapshot';
  $('#sourceBanner').innerHTML=source?.type==='spreadsheet_snapshot'?`<strong>Real spreadsheet data · ${escapeHtml(source.exportDate)}</strong><p>${state.data.canImport?'Supabase setup is ready. Import this snapshot to enable editing.':'Run the management setup SQL to enable importing and saving.'} ${fmt(source.unimportedPeriods)} membership rows are preserved for review; uncertain balances are excluded from dues. Attendance and enquiries were not included in this export.</p>${state.data.canImport?'<button class="button dark" data-import-snapshot>Import real data into Supabase</button>':''}`:'';
  if(source?.type==='supabase'&&state.data.canImport){$('#sourceBanner').hidden=false;$('#sourceBanner').innerHTML='<strong>Existing membership history has not been imported yet.</strong><p>New entries save directly to Supabase. Import the prepared membership snapshot to include your older members and balances.</p><button class="button dark" data-import-snapshot>Import real data into Supabase</button>';}
  $('#exportButton').disabled=state.role==='receptionist';$('#exportButton').hidden=state.role==='receptionist';
}
async function loadDashboard() {
  if(state.busy)return;
  state.busy=true;$('#refreshButton').disabled=true;
  const generation=state.generation;
  $('#periodSelect').disabled=true;$('#previewRole').disabled=true;
  if(!state.data)$('#pageBody').innerHTML='<div class="loading">Bringing your workspace into focus…</div>';
  try {
    const rangeQuery=state.page==='overview'&&state.role!=='trainer'?`&from=${encodeURIComponent(state.overviewRange.from)}&to=${encodeURIComponent(state.overviewRange.to)}`:'';
    const parameterQuery=state.role==='admin'?parametersQuery():'';
    const data=await api((state.preview?`preview?role=${encodeURIComponent(state.role)}&days=${state.days}`:`dashboard?days=${state.days}`)+rangeQuery+parameterQuery);
    if(generation!==state.generation)return;
    state.data=data;
    state.role=state.data.role;$('#errorBanner').hidden=true;document.body.classList.remove('stale');renderShell();renderPage();
  } catch(error) {
    if(generation!==state.generation)return;
    if([401,403].includes(error.status)&&!state.preview){showLogin();$('#loginError').textContent=error.status===403?error.message:'Your session has ended. Please sign in again.';}
    else { $('#errorBanner').textContent=error.message;$('#errorBanner').hidden=false;document.body.classList.add('stale');$('#connectionText').textContent='Refresh needed';$('#freshness').textContent='Could not refresh · showing the last loaded data';if(!state.data)$('#pageBody').innerHTML=empty('Your workspace is taking a moment.', 'Use the refresh button to try again.'); }
  } finally {if(generation===state.generation){state.busy=false;$('#refreshButton').disabled=false;$('#periodSelect').disabled=false;$('#previewRole').disabled=false;}}
}
function showLogin() { $('#entryFields').innerHTML='';if($('#entryDialog').open)$('#entryDialog').close();state.generation++;state.busy=false;state.data=null;state.page='overview';$('#pageBody').innerHTML='';$('#workspace').hidden=true;$('#loginScreen').hidden=false;$('#password').value='';$('#sidebar').classList.remove('open');$('#sidebarScrim').hidden=true;$('#menuButton').setAttribute('aria-expanded','false');$('#periodSelect').disabled=false;$('#previewRole').disabled=false; }
function navigate(page) { state.page=page;state.search='';state.filter='all';renderPage();$('#sidebar').classList.remove('open');$('#sidebarScrim').hidden=true;$('#menuButton').setAttribute('aria-expanded','false');window.scrollTo({top:0,behavior:'instant'});if(!state.preview&&['overview','attendance','parameters'].includes(page))loadDashboard(); }
async function startPreview() {state.generation++;state.busy=false;state.preview=true;state.role='admin';state.data=null;state.page='overview';history.replaceState(null,'','?preview=admin');renderShell();await loadDashboard();}
function exportReport() {
  if(state.role==='receptionist'){toast('Report export is not available for reception.');return;}
  if(!state.data)return;
  if(['sales','admissions','renewals','renewed','review','pt','members','finance','pending','expenses','enquiries','leads','team'].includes(state.page)){exportManagementReport();return;}
  const d=state.data;
  let rows;
  if(state.page==='parameters'&&d.memberParameters){rows=['memberGender','renewalGender','areas'].flatMap(chart=>d.memberParameters[chart].map(v=>({chart,...v,from:d.memberParameters.from||'All time',to:d.memberParameters.to,status:d.memberParameters.status})));}
  else if(state.page==='overview'&&d.gymOverview){rows=Object.entries(d.gymOverview).map(([metric,value])=>({metric,value,from:d.reportRange.from,to:d.reportRange.to}));}
  else if(state.page==='members')rows=d.members.map(m=>({name:m.full_name,admission_id:m.admission_id,phone:m.phone,status:m.membership_status,expiry:m.expiry}));
  else if(state.page==='attendance'&&d.weeklyAttendance)rows=attendanceViewRows(d).map(a=>({name:a.member_name,admission_id:a.admission_id,phone:a.phone,day:a.day||'',punched_at:a.punched_at||'',last_seen:a.last_seen||'',view:state.attendanceMode||'attendance'}));
  else if(state.page==='attendance')rows=d.attendance.map(a=>({name:a.member_name,admission_id:a.admission_id,time_utc:a.punched_at,access:a.access_result}));
  else if(state.page==='finance')rows=d.payments.map(p=>({name:p.member_name,date:p.paid_at,type:p.kind,amount:p.amount,method:p.payment_mode}));
  else if(state.page==='enquiries')rows=d.enquiries;
  else if(state.page==='team')rows=d.staff;
  else if(state.page==='operations')rows=d.syncJobs;
  else rows=Object.entries(d.metrics).map(([metric,value])=>({metric,value:value??'Unavailable'}));
  if(!rows.length){toast('There are no records to export yet.');return;}
  const headers=Object.keys(rows[0]);
  // Neutralize formula prefixes when a CSV is opened in Excel or Sheets.
  const cell=v=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
  const csv='\uFEFF'+[headers.map(cell).join(','),...rows.map(r=>headers.map(h=>cell(r[h])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=`zenith-${state.preview?'sample-':''}${state.page}-${d.today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your report is ready.');
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-go]');if(button)navigate(button.dataset.go);});
document.addEventListener('input',event=>{if(event.target.id==='tableSearch'){const position=event.target.selectionStart;state.search=event.target.value;renderPage();const input=$('#tableSearch');input.focus();input.setSelectionRange(position,position);}});
document.addEventListener('change',event=>{if(event.target.id==='tableFilter'){state.filter=event.target.value;renderPage();}});
$('#loginForm').addEventListener('submit',async event=>{event.preventDefault();$('#loginButton').disabled=true;$('#loginError').textContent='';try{const login=await api('login',{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});state.role=login.staff.role;state.preview=false;state.data=null;state.page='overview';$('#password').value='';history.replaceState(null,'',location.pathname);renderShell();await loadDashboard();}catch(error){$('#loginError').textContent=error.message;}finally{$('#loginButton').disabled=false;}});
$('#showPassword').addEventListener('click',()=>{const show=$('#password').type==='password';$('#password').type=show?'text':'password';$('#showPassword').textContent=show?'Hide':'Show';$('#showPassword').setAttribute('aria-label',show?'Hide password':'Show password');});

$('#exitPreview').addEventListener('click',()=>{state.preview=false;history.replaceState(null,'',location.pathname);showLogin();});
$('#profileButton').addEventListener('click',async()=>{try{if(!state.preview)await api('logout',{method:'POST',body:'{}'});state.preview=false;history.replaceState(null,'',location.pathname);showLogin();}catch(error){toast(error.message);}});
$('#previewRole').addEventListener('change',async event=>{state.role=event.target.value;state.page='overview';state.data=null;history.replaceState(null,'',`?preview=${state.role}`);await loadDashboard();});
$('#periodSelect').addEventListener('change',async event=>{state.days=Number(event.target.value);await loadDashboard();});
$('#refreshButton').addEventListener('click',loadDashboard);
$('#exportButton').addEventListener('click',exportReport);
$('#menuButton').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#sidebarScrim').hidden=!open;$('#menuButton').setAttribute('aria-expanded',String(open));});
$('#sidebarScrim').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#sidebarScrim').hidden=true;$('#menuButton').setAttribute('aria-expanded','false');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#sidebar').classList.remove('open');$('#sidebarScrim').hidden=true;$('#menuButton').setAttribute('aria-expanded','false');}});
setInterval(()=>{if(!document.hidden&&state.data&&!state.preview)loadDashboard();},60000);
try{const updatesChannel=new BroadcastChannel('zenith-membership-updates');updatesChannel.addEventListener('message',()=>{if(state.data&&!state.preview)loadDashboard();});}catch{}
(async()=>{if(state.preview){renderShell();await loadDashboard();return;}try{const {staff}=await api('session');state.role=staff.role;renderShell();await loadDashboard();}catch(error){showLogin();if(error.status!==401)$('#loginError').textContent=error.message;}})();
