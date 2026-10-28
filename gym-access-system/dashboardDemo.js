const { buildDashboard, dateKey } = require('./dashboardMetrics');

function demoDashboard(role = 'admin', days = 30, now = new Date(),range={}) {
  const ago = n => new Date(now.getTime() - n * 86400000).toISOString();
  const names = ['Aarav Mehta', 'Ananya Desai', 'Kabir Shah', 'Ishita Rao', 'Rohan Patil', 'Meera Joshi', 'Arjun Nair', 'Diya Kapoor', 'Vihaan Singh', 'Sara Khan'];
  const plans = [{ id: 'p0', name: '1 Month' }, { id: 'p1', name: '3 Months' }, { id: 'p2', name: '6 Months' }, { id: 'p3', name: '1 Year' }];
  let members = Array.from({ length: 648 }, (_, i) => ({ id: `m${i}`, admission_id: `ZF${String(i + 1).padStart(4, '0')}`, full_name: names[i] || `Sample Member ${String(i+1).padStart(3,'0')}`, phone: `900000${String(i).padStart(4,'0')}`, category: i % 6 === 0 ? 'Personal training' : 'General fitness', is_archived: false, created_at: ago(i < 34 ? i % 29 : 45 + i % 200) }));
  const memberships = members.map((m,i) => ({ id: `s${i}`, member_id: m.id, plan_id: `p${i%4}`, kind: i % 3 === 0 ? 'renewal' : 'admission', purchased_at:m.created_at,start_date: dateKey(ago(32 + i % 15)), end_date: dateKey(ago(i < 482 ? -(i < 17 ? (i % 7) : 15 + i % 90) : 5 + i % 60)), status: 'confirmed', final_amount: [1500, 3900, 6900, 12000][i%4] }));
  const payments = memberships.map((m,i) => ({ id: `pay${i}`, membership_id: m.id, amount: m.final_amount - (i < 9 ? 500 : 0), kind: 'payment', payment_mode: i%3 ? 'UPI' : 'Cash', paid_at: ago(i < 53 ? i % 30 : 35 + i % 150) }));
  const attendance = Array.from({ length: 330 }, (_, i) => ({ id: `a${i}`, member_id: `m${i%100}`, device_user_id: `${i%100+1}`, access_result: i%37 === 0 ? 'restricted' : 'allowed', punched_at: new Date(now.getTime() - (i < 58 ? i * 140000 : (1+i%29)*86400000 + i*10000)).toISOString() }));
  const enquiries = Array.from({ length: 8 }, (_,i) => ({ id: `q${i}`, full_name: `${['Aditya', 'Neha', 'Tanvi', 'Dev', 'Nikhil', 'Priya', 'Sahil', 'Pooja'][i]} (sample)`, phone: '9000000000', interested_plan: plans[i%4].name, status: i<5 ? 'new' : 'contacted', follow_up_date: dateKey(ago(i%2 ? 0 : -1)), created_at: ago(i+1) }));
  const staff = [{ id: 't0', full_name: 'Zenith Admin', role: 'admin', is_active: true }, { id: 't1', full_name: 'Riya Shah', role: 'receptionist', is_active: true }, { id: 't2', full_name: 'Rahul Nair', role: 'trainer', is_active: true }, { id: 't3', full_name: 'Sneha Joshi', role: 'trainer', is_active: true }];
  const jobs = [{ id: 'j1', destination: 'google_sheets', event_type: 'membership.updated', status: 'completed', attempts: 1, created_at: ago(0) }];
  if (role === 'trainer') members = members.slice(0, 12);
  const allowed = new Set(members.map(m => m.id));
  return { preview: true, currentStaff: role === 'admin' ? staff[0] : role === 'receptionist' ? staff[1] : staff[2], ...buildDashboard({ members, memberships, payments, plans, attendance: attendance.filter(a => allowed.has(a.member_id)), enquiries, staff, syncJobs: jobs, auditLogs: [{ id: 'l1', action: 'membership.renewed', entity_type: 'membership', created_at: ago(0) }] }, { role, days, now,...range }) };
}

module.exports = { demoDashboard };
