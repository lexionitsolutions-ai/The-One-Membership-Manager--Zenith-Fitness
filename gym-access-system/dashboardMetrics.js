const DAY = 86400000;
const {reportRange,packageGroup,collectionChannel}=require('./reporting');
const {isPersonalTraining,buildMemberReviews}=require('./memberReviewData');
const {receptionActivity}=require('./receptionActivity');
const {memberParameters,cashbookEntry}=require('./memberParameters');
const {buildAttendanceReport}=require('./attendanceReports');
const INDIA_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

function dateKey(value) {
  return INDIA_DAY_FORMAT.format(new Date(value));
}

function buildDashboard(data, { role, days = 30, now = new Date(), from, to,parameterFilter }) {
  const today = dateKey(now);
  const dayStart = new Date(`${today}T00:00:00+05:30`);
  const range=reportRange(from,to,now,days);
  const start = range.start;
  days=range.days;
  const previousStart = new Date(start.getTime() - days * DAY);
  const memberships = data.memberships || [];
  const members = data.members || [];
  const ptMemberIds=new Set(members.filter(isPersonalTraining).map(m=>m.id));
  const gymPeriods=memberships.filter(m=>!ptMemberIds.has(m.member_id));
  const attendance = data.attendance || [];
  const ledgerPayments = data.payments || [];
  const ptContracts=data.ptContracts||[];
  const ptPayments=(data.ptPayments||[]).map(p=>({...p,kind:'payment',source:'personal_training',member_name:members.find(m=>m.id===ptContracts.find(c=>c.id===p.contract_id)?.member_id)?.full_name||'PT member'}));
  const ptBalances=ptContracts.map(c=>({...c,trainer_name:(data.ptTrainers||[]).find(t=>t.id===c.trainer_id)?.name||'Trainer',paid_amount:ptPayments.filter(p=>p.contract_id===c.id&&new Date(p.paid_at)<=now).reduce((s,p)=>s+Number(p.amount),0)})).map(c=>({...c,outstanding:Math.max(0,Number(c.total_amount)-c.paid_amount)}));
  const payments = [...ledgerPayments,...ptPayments, ...(data.historicalReceipts || []).map(r => ({...r,paid_at:r.received_at,kind:'payment',member_name:r.description || r.transaction_type || 'Historical collection',source:'cashbook'}))];
  const active = new Set(memberships.filter(m => m.status === 'confirmed' && m.start_date <= today && m.end_date >= today).map(m => m.member_id));
  const archived = new Set(members.filter(m => m.is_archived).map(m => m.id));
  for (const id of archived) active.delete(id);
  const signed = p => Number(p.amount || 0) * (p.kind === 'refund' ? -1 : 1);
  const inRange = (value, from, to) => new Date(value) >= from && new Date(value) < to;
  const end = range.end;
  const currentPayments = payments.filter(p => inRange(p.paid_at, start, end));
  const previousPayments = payments.filter(p => inRange(p.paid_at, previousStart, start));
  const revenue = currentPayments.reduce((sum, p) => sum + signed(p), 0);
  const previousRevenue = previousPayments.reduce((sum, p) => sum + signed(p), 0);
  const paidByMembership = new Map();
  for (const p of ledgerPayments.filter(p => new Date(p.paid_at) <= now)) paidByMembership.set(p.membership_id, (paidByMembership.get(p.membership_id) || 0) + signed(p));
  const balances = memberships.filter(m => m.status === 'confirmed' && m.accounting_verified !== false).map(m => ({ ...m, outstanding: Math.max(0, Number(m.final_amount ?? m.historical_charge) - Number(m.opening_paid_amount || 0) - (paidByMembership.get(m.id) || 0)) }));
  const pending = balances.reduce((sum, m) => sum + m.outstanding, 0)+ptBalances.reduce((s,p)=>s+p.outstanding,0);
  const periodAmounts=m=>m.accounting_verified===false||m.final_amount==null&&m.historical_charge==null?{paid_amount:null,outstanding:null}:{paid_amount:Number(m.opening_paid_amount||0)+(paidByMembership.get(m.id)||0),outstanding:Math.max(0,Number(m.final_amount??m.historical_charge)-Number(m.opening_paid_amount||0)-(paidByMembership.get(m.id)||0))};
  const next7 = dateKey(new Date(dayStart.getTime() + 7 * DAY));
  // A member with a later confirmed renewal is not due on an older period.
  const latest = new Map();
  for (const m of memberships.filter(m => m.status === 'confirmed')) {
    if (!latest.has(m.member_id) || m.end_date > latest.get(m.member_id).end_date) latest.set(m.member_id, m);
  }
  const due = [...latest.values()].filter(m => !ptMemberIds.has(m.member_id)&&m.end_date >= today && m.end_date <= next7 && !archived.has(m.member_id));
  const lookup = new Map(members.map(m => [m.id, m]));
  const enrich = row => ({ ...row, member_name: lookup.get(row.member_id)?.full_name || 'Unmapped member', admission_id: lookup.get(row.member_id)?.admission_id || row.device_user_id || '—' });
  const todaysPunches = attendance.filter(a => dateKey(a.punched_at) === today);
  const present = new Set(todaysPunches.filter(a => a.member_id && a.access_result !== 'restricted').map(a => a.member_id));
  const activity = attendance.filter(a => inRange(a.punched_at, start, end)).sort((a,b) => new Date(b.punched_at) - new Date(a.punched_at));
  const points = Array.from({ length: Math.min(days,90) }, (_, i) => {
    const date = dateKey(new Date(start.getTime() + i * DAY));
    return { date, revenue: currentPayments.filter(p => dateKey(p.paid_at) === date).reduce((sum, p) => sum + signed(p), 0), visits: new Set(activity.filter(a => dateKey(a.punched_at) === date && a.member_id && a.access_result !== 'restricted').map(a => a.member_id)).size };
  });
  const result = {
    today, days, reportRange:{from:range.from,to:range.to}, generatedAt: now.toISOString(), role,
    metrics: { totalMembers: members.filter(m => !m.is_archived).length, activeMembers: role === 'trainer' ? null : active.size, presentToday: present.size, visits: activity.length, renewalDue: role === 'trainer' ? null : due.length },
    members: members.map(m => ({ ...m, membership_status: m.is_archived ? 'Archived' : role === 'trainer' ? 'Assigned' : active.has(m.id) ? 'Active' : latest.get(m.id)?.start_date > today ? 'Upcoming' : 'Inactive', expiry: role === 'trainer' ? null : latest.get(m.id)?.end_date || null })),
    attendance: activity.slice(0, 100),
    recentAttendance: activity.slice(0, 8).map(enrich),
    series: points.map(p => role === 'trainer' ? { date: p.date, visits: p.visits } : p),
  };
  result.attendance = result.attendance.map(enrich);
  if (role !== 'trainer') {
    result.weeklyAttendance=buildAttendanceReport(data,now);
    const legacyPT=memberships.filter(m=>ptMemberIds.has(m.member_id)).map(m=>({...enrich(m),...periodAmounts(m),total_amount:m.final_amount??m.historical_charge,plan_name:(data.plans||[]).find(p=>p.id===m.plan_id)?.name||'Historical PT',trainer_name:'Not recorded',package:'legacy',legacy_membership:true,...(m.status==='cancelled'?{outstanding:0}:{})}));
    result.personalTraining=[...ptBalances.map(enrich),...legacyPT];
    result.legacyPTBalances=balances.filter(m=>ptMemberIds.has(m.member_id)&&m.outstanding>0).map(enrich);
    result.metrics.ptPending=result.personalTraining.filter(p=>p.status!=='cancelled').reduce((s,p)=>s+Number(p.outstanding||0),0);
    result.reviewMembers=buildMemberReviews(data,today);
    const anchor=new Date(range.to+'T12:00:00Z');
    const weekStart=dateKey(new Date(new Date(range.to+'T00:00:00+05:30').getTime()-((anchor.getUTCDay()+6)%7)*DAY));
    const reportMembers=members.filter(m=>!m.is_archived&&(!m.created_at||dateKey(m.created_at)<=range.to));
    const reportIds=new Set(reportMembers.map(m=>m.id));
    const rangeActive=new Set(memberships.filter(m=>m.status==='confirmed'&&m.start_date<=range.to&&m.end_date>=range.to).map(m=>m.member_id));
    const countPeriods=(kind,first,last)=>gymPeriods.filter(m=>m.kind===kind&&m.status==='confirmed'&&(m.purchased_at?dateKey(m.purchased_at):m.start_date)>=first&&(m.purchased_at?dateKey(m.purchased_at):m.start_date)<=last).length;
    const channelTotal=channel=>currentPayments.filter(p=>collectionChannel(p.payment_mode)===channel).reduce((sum,p)=>sum+signed(p),0);
    result.gymOverview={
      asOf:range.to,weekStart,monthStart:range.to.slice(0,7)+'-01',
      dailyAdmissions:countPeriods('admission',range.to,range.to),weeklyAdmissions:countPeriods('admission',weekStart,range.to),monthlyAdmissions:countPeriods('admission',range.to.slice(0,7)+'-01',range.to),
      dailyRenewals:countPeriods('renewal',range.to,range.to),weeklyRenewals:countPeriods('renewal',weekStart,range.to),monthlyRenewals:countPeriods('renewal',range.to.slice(0,7)+'-01',range.to),
      selectedAdmissions:countPeriods('admission',range.from,range.to),selectedRenewals:countPeriods('renewal',range.from,range.to),
      cashCollected:channelTotal('cash'),onlineCollected:channelTotal('online'),otherCollected:channelTotal('other'),totalCollected:revenue,
      totalMembers:reportMembers.length,activeMembers:[...rangeActive].filter(id=>reportIds.has(id)).length,
      inactiveMembers:reportMembers.filter(m=>!rangeActive.has(m.id)).length,
      estimatedSubmissionDates:memberships.filter(m=>!m.purchased_at).length,
    };
    Object.assign(result.metrics, { revenue, previousRevenue, revenueChange: previousRevenue ? (revenue - previousRevenue) / Math.abs(previousRevenue) * 100 : null, pending, newMembers: members.filter(m => inRange(m.created_at, start, end)).length });
    result.renewals = due.sort((a,b) => a.end_date.localeCompare(b.end_date)).map(enrich);
    result.balances = balances.filter(m => !ptMemberIds.has(m.member_id)&&m.outstanding > 0).sort((a,b) => b.outstanding-a.outstanding).map(enrich);
    result.payments = currentPayments.sort((a,b) => new Date(b.paid_at)-new Date(a.paid_at)).map(p => ({ ...p, member_name: p.member_name || lookup.get(memberships.find(m => m.id === p.membership_id)?.member_id)?.full_name || 'Unknown member' }));
    result.allPayments = payments.filter(p=>new Date(p.paid_at)<=now).sort((a,b)=>new Date(b.paid_at)-new Date(a.paid_at)).map(p=>({...p,member_name:p.member_name||lookup.get(memberships.find(m=>m.id===p.membership_id)?.member_id)?.full_name||'Unknown member',...cashbookEntry(p,data)}));
    result.memberships = gymPeriods.map(m => {const plan=(data.plans||[]).find(p=>p.id===m.plan_id)||{};return {...enrich(m),...periodAmounts(m),plan_name:plan.name||'Historical plan',package_group:packageGroup(m,plan), final_amount:m.final_amount??m.historical_charge};});
    result.renewalSchedule=[...latest.values()].filter(m=>!ptMemberIds.has(m.member_id)&&!archived.has(m.member_id)).map(m=>{const plan=(data.plans||[]).find(p=>p.id===m.plan_id)||{};return{...enrich(m),...periodAmounts(m),phone:lookup.get(m.member_id)?.phone,expiry_month:m.end_date.slice(0,7),plan_name:plan.name||'Historical plan',package_group:packageGroup(m,plan)};}).sort((a,b)=>a.end_date.localeCompare(b.end_date));
    result.plans = data.plans || [];
    result.metrics.unreconciledPeriods = memberships.filter(m=>m.accounting_verified===false).length;
    result.monthlySales = [...new Set([...payments.map(p=>dateKey(p.paid_at).slice(0,7)), ...(data.expenses||[]).map(e=>e.expense_date.slice(0,7)), ...memberships.map(m=>m.start_date.slice(0,7))])].sort().reverse().map(month=>{
      const monthlyPayments=payments.filter(p=>dateKey(p.paid_at).startsWith(month)&&new Date(p.paid_at)<=now);
      const collections=monthlyPayments.reduce((s,p)=>s+signed(p),0);
      const expenses=(data.expenses||[]).filter(e=>e.status==='recorded'&&e.expense_date.startsWith(month)).reduce((s,e)=>s+Number(e.amount),0);
      return {month,collections,expenses,cashBalance:collections-expenses,admissions:gymPeriods.filter(m=>m.kind==='admission'&&m.start_date.startsWith(month)).length,renewals:gymPeriods.filter(m=>m.kind==='renewal'&&m.start_date.startsWith(month)).length};
    });
    result.planMix = (data.plans || []).map(p => ({ name: p.name, count: [...latest.values()].filter(m => m.plan_id === p.id && active.has(m.member_id)).length }));
    result.enquiries = data.enquiries || [];
  }
  if (role === 'admin') {
    result.memberParameters=memberParameters(data,parameterFilter||range,parameterFilter||{});
    result.receptionActivity=receptionActivity(data,range);
    result.receptionActivitySetupRequired=Boolean(data.receptionActivitySetupRequired);
    result.staff = data.staff || [];
    result.syncJobs = data.syncJobs || [];
    result.auditLogs = data.auditLogs || [];
    result.expenses = data.expenses || [];
    result.dataQuality = {heldPeriods:(data.reviewRecords||[]).filter(r=>r.import_status==='needs_review').length,unreconciledPeriods:result.metrics.unreconciledPeriods};
  }
  if(role==='receptionist'){
    result.expenses=data.expenses||[];
    delete result.payments;delete result.allPayments;delete result.monthlySales;
    for(const key of ['revenue','previousRevenue','revenueChange'])delete result.metrics[key];
    for(const key of ['cashCollected','onlineCollected','otherCollected','totalCollected'])delete result.gymOverview[key];
    result.series=result.series.map(({date,visits})=>({date,visits}));
  }
  return result;
}

module.exports = { buildDashboard, dateKey };
