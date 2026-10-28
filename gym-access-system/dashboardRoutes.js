const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildDashboard } = require('./dashboardMetrics');
const { demoDashboard } = require('./dashboardDemo');
const {reportRange,packageGroup,validDate}=require('./reporting');
const {createSecondaryBridge}=require('./secondaryBridge');
const {projectFallback}=require('./fallbackProjection');
const {deviceTargets,validateAccessDate}=require('./supabaseFingerprint');
const messages=require('./public/dashboard/whatsapp-templates');
const {resolveStaffLogin}=require('./staffLogin');
const {staffAccountInput,createStaffAccount}=require('./staffAccounts');
const {createOpenOperations}=require('./openOperations');
const {endDate:packageEndDate}=require('../package-dates');
const {ageOn:memberAgeOn}=require('../member-dates');
const {createAttendanceImporter}=require('./attendanceImport');
const {parameterFilter}=require('./memberParameters');
const {createCloudBridge}=require('./cloudBridge');
const {accessToken,grantFormsAccess,hasFormsAccess}=require('./formsAccess');

function createDashboardRouter({ fetchImpl = fetch, secondaryOptions = {},sessionStore=new Map(),operationStore=new Map(),attendanceOptions={} } = {}) {
  const router = express.Router();
  const sessions = sessionStore;
  const attempts = new Map();
  const publicAttempts=new Map();
  const attendanceImporter=createAttendanceImporter({fetchImpl,...attendanceOptions});
  const cloudBridge=createCloudBridge({fetchImpl});
  const COOKIE = 'zenith_staff_session';
  const sessionLife = 400 * 24 * 60 * 60 * 1000;
  const housekeeping = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    for (const [key, value] of publicAttempts) if (value.until < now) publicAttempts.delete(key);
  }, 60000);
  housekeeping.unref();

  function config() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      throw Object.assign(new Error('Supabase configuration is missing. Restart the server after saving .env.'), { status: 503 });
    }
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
  }
  async function request(endpoint, { token, method = 'GET', body, headers = {}, timeout = 20000 } = {}) {
    const { url, key } = config();
    let response;
    try {
      response = await fetchImpl(new URL(endpoint, url), { method, headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw Object.assign(new Error('Supabase could not be reached. Please try again.'), { status: 502 });
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const message = endpoint.startsWith('/auth/') ? (data?.msg || data?.error_description || 'Sign-in failed. Check your credentials and email confirmation.') : data?.code==='P0001' ? data.message : ['22007','22008','22P02','23514'].includes(data?.code) ? 'Some values are invalid. Check dates, amounts and required fields.' : 'Unable to complete the database request. Check staff permissions and management setup.';
      throw Object.assign(new Error(message), { status: endpoint.startsWith('/auth/') && response.status === 400 ? 401 : response.status >= 500 ? 502 : response.status, databaseCode:data?.code, schemaMissing:['42P01','42703','PGRST202','PGRST204','PGRST205'].includes(data?.code), detail:data?.message });
    }
    return data;
  }
  async function rows(table, query, token) {
    const result = [];
    // Read past PostgREST's default 1,000-row limit without silently truncating.
    for (let offset = 0; ; offset += 500) {
      if (offset >= 50000) throw Object.assign(new Error('This report is too large. A server-side aggregate is required.'), { status: 422 });
      const page = await request(`/rest/v1/${table}?${query}&limit=500&offset=${offset}`, { token });
      if (!Array.isArray(page)) throw Object.assign(new Error('Unexpected database response.'), { status: 502 });
      result.push(...page);
      if (page.length < 500) return result;
    }
  }
  function sessionId(req) {
    return (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }
  function setCookie(req, res, id, maxAge) {
    res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/api/portal', maxAge });
  }
  async function staffFor(token, userId) {
    const staff = await rows('staff', `select=id,gym_id,user_id,full_name,role,is_active&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&order=created_at.asc,id.asc`, token);
    if (!staff.length || !['admin', 'receptionist', 'trainer'].includes(staff[0].role)) throw Object.assign(new Error('Your account has no active gym staff assignment. Ask your admin to enable access.'), { status: 403 });
    return staff[0];
  }
  async function authenticated(req) {
    const id = sessionId(req);
    let session = await sessions.get(id);
    if (!session) {
      await sessions.delete(id);
      throw Object.assign(new Error('Please sign in to continue.'), { status: 401 });
    }
    if (session.expiresAt < Date.now() + 60000) {
      if(sessions.refresh){
        try{session=await sessions.refresh(id,async current=>{const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:current.refreshToken}});return {...current,accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:Date.now()+data.expires_in*1000};});}
        catch(error){if(error.status===401)await sessions.delete(id);throw error;}
      }else{
      session.refreshing ||= request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refreshToken } }).then(data => {
        session.accessToken = data.access_token;
        session.refreshToken = data.refresh_token;
        session.expiresAt = Date.now() + data.expires_in * 1000;
        const {refreshing,...saved}=session;return sessions.set(id,saved);
      }).finally(() => { session.refreshing = null; });
      try { await session.refreshing; } catch (error) { if(error.status===401)await sessions.delete(id);throw error; }
      }
    }
    // RLS is applied with the user's token, and current staff assignment is rechecked.
    const staff = await staffFor(session.accessToken, session.userId);
    if(req.res)setCookie(req,req.res,id,sessionLife);
    return { session, staff };
  }
  const openOperation=createOpenOperations({store:operationStore,request,fetchImpl,staffFor});
  async function operational(req,options={}){
    if(sessionId(req)){try{const auth=await authenticated(req);if(['admin','receptionist'].includes(auth.staff.role)||process.env.OPEN_OPERATIONS_ENABLED!=='1')return auth;}catch(e){if(e.status!==401)throw e;}}
    if(options.publicForm&&process.env.VERCEL&&!hasFormsAccess(req)){
      const now=Date.now(),previous=publicAttempts.get(req.ip),limit=previous&&previous.until>now?previous:{count:0,until:now+5*60000};
      if(++limit.count>120)throw Object.assign(new Error('Too many form requests. Please try again in a few minutes.'),{status:429});publicAttempts.set(req.ip,limit);
    }
    return openOperation(req,options);
  }
  async function deviceOperational(req){
    if(process.env.OPEN_OPERATIONS_ENABLED==='1')return openOperation(req);
    return authenticated(req);
  }
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) return res.status(403).json({ error: 'Use the gym portal to make this request.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Expected JSON request.' });
    }
    next();
  });
  router.post('/login', async (req, res, next) => {
    try {
      const now = Date.now();
      const previous = attempts.get(req.ip);
      const attempt = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60000 };
      if (attempt.count >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' });
      attempt.count++;
      attempts.set(req.ip, attempt);
      const login = String(req.body?.username ?? req.body?.email ?? '').trim();
      const email = resolveStaffLogin(login);
      const password = req.body?.password;
      if (!email || typeof password !== 'string' || !password || email.length > 320 || password.length > 1024) return res.status(400).json({ error: 'Enter your contact number or email and password.' });
      const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      const staff = await staffFor(data.access_token, data.user.id);
      const id = crypto.randomBytes(32).toString('hex');
      await sessions.delete(sessionId(req));
      await sessions.set(id, { accessToken: data.access_token, refreshToken: data.refresh_token, userId: data.user.id, expiresAt: now + data.expires_in * 1000 });
      attempts.delete(req.ip);
      setCookie(req, res, id, sessionLife);
      if(process.env.VERCEL&&staff.gym_id===process.env.OPEN_OPERATIONS_GYM_ID&&['admin','receptionist'].includes(staff.role))grantFormsAccess(req,res);
      res.json({ staff });
    } catch (error) { next(error); }
  });
  router.get('/preview', (req, res) => {
    const role = ['admin', 'receptionist', 'trainer'].includes(req.query.role) ? req.query.role : 'admin';
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    reportRange(req.query.from,req.query.to,new Date(),days);
    res.json(demoDashboard(role, days,new Date(),{from:req.query.from,to:req.query.to}));
  });
  router.post('/logout', async (req, res,next) => {try{
    const id = sessionId(req);
    const session = await sessions.get(id);
    await sessions.delete(id);
    setCookie(req, res, '', 0);
    if(process.env.VERCEL)res.clearCookie('zenith_forms_access',{path:'/'});
    if (session) await request('/auth/v1/logout?scope=local', { method: 'POST', token: session.accessToken }).catch(() => {});
    res.json({ success: true });
    }catch(e){next(e);}
  });
  router.get('/session', async (req, res, next) => {
    try { const { staff } = await authenticated(req);setCookie(req,res,sessionId(req),sessionLife);res.json({ staff }); } catch (error) { next(error); }
  });
  router.get('/operations-session',async(req,res,next)=>{try{await openOperation(req);res.json({openAccess:true});}catch(e){next(e);}});
  router.get('/forms-link',async(req,res,next)=>{try{const {staff}=await authenticated(req);requireRole(staff,['admin']);if(staff.gym_id!==process.env.OPEN_OPERATIONS_GYM_ID)throw Object.assign(new Error('This gym does not own the private forms link.'),{status:403});res.json({url:`${req.protocol}://${req.get('host')}/staff-access/${accessToken()}`});}catch(e){next(e);}});
  router.get('/bridge-jobs/:id',async(req,res,next)=>{try{const {staff}=await operational(req);requireRole(staff,['admin','receptionist']);const job=await cloudBridge.job(staff.gym_id,req.params.id);if(staff.role==='receptionist'&&job.kind!=='attendance_refresh')throw Object.assign(new Error('This job requires administrator access.'),{status:403});res.json(job);}catch(e){next(e);}});
  function sourceDashboard(staff, days, ready=false, range={}) {
    const file=path.join(__dirname,'..','migration-data','real-data','snapshot.json');
    if(!fs.existsSync(file)) throw Object.assign(new Error('The real-data snapshot has not been prepared.'),{status:503});
    const source=JSON.parse(fs.readFileSync(file,'utf8'));
    if(staff.gym_id!==source.gym_id)throw Object.assign(new Error('No spreadsheet snapshot is configured for this gym.'),{status:404});
    const data=staff.role==='trainer'?{members:[],attendance:[]}:{...source,staff:[staff],syncJobs:[],auditLogs:[]};
    return {currentStaff:staff,...buildDashboard(data,{role:staff.role,days,...range}),source:{...source.source,readOnly:true},setupRequired:!ready,canImport:ready&&staff.role==='admin'};
  }
  router.get('/source-dashboard',async(req,res,next)=>{
    try{const {staff}=await authenticated(req);res.json(sourceDashboard(staff,[7,30,90].includes(Number(req.query.days))?Number(req.query.days):30,false,{from:req.query.from,to:req.query.to}));}catch(e){next(e);}
  });
  router.get('/dashboard', async (req, res, next) => {
    try {
      const { staff, session } = await authenticated(req);
      const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
      const range={from:req.query.from,to:req.query.to};reportRange(range.from,range.to,new Date(),days);
      const parameterSelection=staff.role==='admin'?parameterFilter(req.query):undefined;
      const gym = `gym_id=eq.${staff.gym_id}`;
      const load = (table, select, extra = '') => rows(table, `select=${select}&${gym}${extra}&order=id.asc`, session.accessToken);
      const data = {gymId:staff.gym_id};
      const tasks = [
        load('members', 'id,admission_id,device_user_id,full_name,phone,gender,category,is_archived,created_at,needs_review').then(x => { data.members = x; }),
        load('attendance', 'id,member_id,device_user_id,punched_at,access_result', `&punched_at=gte.${new Date(Date.now() - 91 * 86400000).toISOString()}`).then(x => { data.attendance = x; }),
      ];
      if (staff.role !== 'trainer') tasks.push(
        load('memberships', 'id,member_id,plan_id,kind,start_date,end_date,status,final_amount,historical_charge,opening_paid_amount,accounting_verified,purchased_at').then(x => { data.memberships = x; }),
        load('payments', 'id,membership_id,amount,kind,payment_mode,paid_at').then(x => { data.payments = x; }),
        load('membership_plans', 'id,name,code,duration_days').then(x => { data.plans = x; }),
        load('enquiries','id,full_name,phone,email,address,source,interested_plan,status,lead_status,follow_up_date,next_follow_up_date,notes,remark,needs_review,created_at').then(x=>{data.enquiries=x;data.enquirySetupRequired=false;}).catch(async error=>{
          if(!error.schemaMissing)throw error;
          data.enquiries=await load('enquiries','id,full_name,phone,interested_plan,status,follow_up_date,notes,created_at');data.enquirySetupRequired=true;
        }),
        load('member_reviews','id,member_id,membership_id,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,updated_at').then(x=>{data.memberReviews=x;data.memberReviewSetupRequired=false;}).catch(e=>{if(!e.schemaMissing)throw e;data.memberReviews=[];data.memberReviewSetupRequired=true;}),
        load('expenses','id,expense_date,category,description,amount,payment_mode,status').then(x=>{data.expenses=x;}),
        load('historical_receipts','id,received_at,description,transaction_type,amount,payment_mode').then(x=>{data.historicalReceipts=x;}),
        Promise.all([load('pt_contracts','id,member_id,trainer_id,package,start_date,end_date,total_amount,notes,created_at'),load('pt_payments','id,contract_id,amount,payment_mode,paid_at'),load('pt_trainers','id,name')]).then(([contracts,payments,trainers])=>{data.ptContracts=contracts;data.ptPayments=payments;data.ptTrainers=trainers;data.ptSetupRequired=false;}).catch(e=>{if(!e.schemaMissing)throw e;data.ptSetupRequired=true;}),
      );
      if (staff.role === 'admin') tasks.push(
        rows('member_private_details',`select=member_id,address&${gym}&order=member_id.asc`,session.accessToken).then(x=>{data.privateDetails=x;}),
        load('migration_records','id,import_status').then(x=>{data.reviewRecords=x;}),
        load('staff', 'id,user_id,full_name,role,is_active').then(x => { data.staff = x; }),
        ...[['enquiry_followups','enquiryFollowups','id,enquiry_id,actor_user_id,from_status,to_status,next_follow_up_date,remark,created_at'],['member_review_history','memberReviewHistory','id,membership_id,recorded_by,status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,created_at']].map(([table,key,fields])=>{
          const period=reportRange(range.from,range.to,new Date(),days);
          return load(table,fields,`&created_at=gte.${period.start.toISOString()}&created_at=lt.${period.end.toISOString()}`).then(x=>{data[key]=x;}).catch(e=>{if(!e.schemaMissing)throw e;data[key]=[];data.receptionActivitySetupRequired=true;});
        }),
        request(`/rest/v1/sync_jobs?select=id,destination,event_type,status,attempts,last_error,created_at&${gym}&order=created_at.desc,id.desc&limit=20`, { token: session.accessToken }).then(x => { data.syncJobs = x; }),
        request(`/rest/v1/audit_logs?select=id,action,entity_type,created_at&${gym}&order=created_at.desc,id.desc&limit=20`, { token: session.accessToken }).then(x => { data.auditLogs = x; }),
      );
      try { await Promise.all(tasks); }
      catch(error){if(error.schemaMissing){return res.json(sourceDashboard(staff,days,false,range));}throw error;}
      const initialSnapshotPath=path.join(__dirname,'..','migration-data','real-data','snapshot.json');
      const canImport=staff.role==='admin'&&data.members.length===0&&fs.existsSync(initialSnapshotPath)&&JSON.parse(fs.readFileSync(initialSnapshotPath,'utf8')).gym_id===staff.gym_id;
      const messageSettings=staff.role==='trainer'?null:await messageTemplates(staff,session.accessToken);
      if(staff.role!=='trainer')data.attendanceStatus=await attendanceImporter.status(staff.gym_id);
      res.json({ currentStaff: staff, ...buildDashboard(data, { role: staff.role, days,...range,parameterFilter:parameterSelection }),memberReviewSetupRequired:data.memberReviewSetupRequired,whatsappTemplates:messageSettings?.templates,whatsappSetupRequired:messageSettings?.setupRequired,canImport,ptSetupRequired:data.ptSetupRequired,enquirySetupRequired:data.enquirySetupRequired,enquiryImportAvailable:staff.role==='admin'&&fs.existsSync(path.join(__dirname,'..','migration-data','enquiries','prepared.json')),source:{type:'supabase',readOnly:false},setupRequired:false });
    } catch (error) { next(error); }
  });
  function requireRole(staff,roles){if(!roles.includes(staff.role))throw Object.assign(new Error('Your staff role cannot perform this action.'),{status:403});}
  async function messageTemplates(staff,token){
    try{return {templates:await rows('whatsapp_templates',`select=template_key,title,body,variables,updated_at&gym_id=eq.${staff.gym_id}&order=template_key.asc`,token),setupRequired:false};}
    catch(error){if(!error.schemaMissing)throw error;return {templates:messages.specs.map(s=>({...s,updated_at:null})),setupRequired:true};}
  }
  router.get('/whatsapp-templates',async(req,res,next)=>{
    try{const {staff,session,publicAccess}=await operational(req,{publicForm:true});requireRole(staff,['admin','receptionist']);const settings=await messageTemplates(staff,session.accessToken);if(publicAccess)settings.templates=settings.templates.filter(t=>['admission','renewed','enquiry','pt'].includes(t.template_key));res.json(settings);}catch(e){next(e);}
  });
  router.post('/member-reviews',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);const {requestId,...payload}=req.body;
      res.json(await request('/rest/v1/rpc/save_member_review',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(requestId),payload}}));
    }catch(e){if(e.schemaMissing)e.message='Run migration 011 to enable member review follow-ups.';next(e);}
  });
  router.get('/member-reviews/:id/history',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      res.json({history:await rows('member_review_history',`select=status,reason,reason_other,return_date,next_follow_up_date,contact_type,remark,created_at&gym_id=eq.${staff.gym_id}&membership_id=eq.${uuid(req.params.id)}&order=created_at.desc,id.desc`,session.accessToken)});
    }catch(e){next(e);}
  });
  router.put('/whatsapp-templates/:key',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      if(!messages.specs.some(s=>s.template_key===req.params.key)||typeof req.body.body!=='string'||!req.body.body.trim()||req.body.body.length>6000||typeof req.body.expected_updated_at!=='string')throw Object.assign(new Error('Enter a valid message and reload its saved version before editing.'),{status:400});
      const template=await request('/rest/v1/rpc/save_whatsapp_template',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,target_key:req.params.key,new_body:req.body.body,expected_updated_at:req.body.expected_updated_at}});res.json({template});
    }catch(e){if(e.schemaMissing)e.message='Run migration 010 before saving WhatsApp messages.';next(e);}
  });
  const bridge=createSecondaryBridge({setAccessDate:date=>{
    const envFile=path.join(__dirname,'..','.env');let contents=fs.readFileSync(envFile,'utf8');
    contents=/^DEVICE_ACCESS_DATE=/m.test(contents)?contents.replace(/^DEVICE_ACCESS_DATE=.*$/m,'DEVICE_ACCESS_DATE='+date):contents.trimEnd()+'\nDEVICE_ACCESS_DATE='+date+'\n';
    fs.writeFileSync(envFile,contents);process.env.DEVICE_ACCESS_DATE=date;
  },...secondaryOptions,rpc:(name,body,token)=>request('/rest/v1/rpc/'+name,{method:'POST',token,body,timeout:60000})});
  router.get('/secondary-sync/preview',async(req,res,next)=>{
    try{const {staff,session}=await deviceOperational(req);requireRole(staff,['admin']);
      const snapshot=await request('/rest/v1/rpc/get_fallback_snapshot',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id}});
      const projection=projectFallback(snapshot);let serviceAccount='';
      try{serviceAccount=JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_FILE||path.join(__dirname,'credentials.json'),'utf8')).client_email||'';}catch{}
      const mapped=snapshot.members.filter(m=>m.device_user_id!==null);
      let accessDate;
      if(req.query.date){try{accessDate=validateAccessDate(req.query.date);}catch(e){throw Object.assign(e,{status:400});}}
      res.json({spreadsheetId:process.env.FALLBACK_SPREADSHEET_ID||'',deviceEnabled:process.env.SUPABASE_DEVICE_SYNC_ENABLED==='1',accessDate:accessDate||null,serviceAccount,bridge:process.env.VERCEL?await cloudBridge.status(staff.gym_id):null,rows:Object.fromEntries(Object.entries(projection).map(([name,rows])=>[name,rows.length-1])),lastAdmissionID:projection['System Control'][1][1],devices:deviceTargets(snapshot,mapped.map(m=>m.id),accessDate),note:'Preview only. No workbook or fingerprint device was changed.'});
    }catch(e){if(e.schemaMissing)e.message='Run migration 008 to enable fallback and fingerprint syncing.';next(e);}
  });
  router.post('/fingerprint-date-sync',async(req,res,next)=>{
    try{const {staff,session}=await deviceOperational(req);requireRole(staff,['admin']);
      let date;try{date=validateAccessDate(req.body.date);}catch(e){throw Object.assign(e,{status:400});}
      if(process.env.VERCEL)return res.status(202).json(await cloudBridge.enqueue(staff.gym_id,staff.user_id,'fingerprint_date_sync',{date}));
      const result=await bridge.run({gymId:staff.gym_id,token:session.accessToken,destination:'fingerprint',force:true,manualDate:date});
      if(result.success&&!result.busy){try{result.attendanceRefresh=await attendanceImporter.run(staff.gym_id,staff.user_id);}catch(e){result.attendanceRefresh={success:false,error:e.message};}}
      res.json(result);
    }catch(e){if(e.schemaMissing)e.message='Run migration 008 before syncing.';if(!e.status)e.status=503;next(e);}
  });
  router.post('/attendance/refresh',async(req,res,next)=>{
    try{const {staff}=await authenticated(req);requireRole(staff,['admin','receptionist']);if(process.env.VERCEL)return res.status(202).json(await cloudBridge.enqueue(staff.gym_id,staff.user_id,'attendance_refresh',{}));res.json(await attendanceImporter.run(staff.gym_id,staff.user_id));}
    catch(e){if(!e.status)e.status=503;next(e);}
  });
  router.post('/secondary-sync',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);const destination=req.body.destination;
      if(!['google_sheets','fingerprint'].includes(destination))throw Object.assign(new Error('Choose a valid sync destination.'),{status:400});
      if(process.env.VERCEL)return res.status(202).json(await cloudBridge.enqueue(staff.gym_id,staff.user_id,'secondary_sync',{destination}));
      const result=await bridge.run({gymId:staff.gym_id,token:session.accessToken,destination,force:true});
      if(destination==='fingerprint'&&result.success&&!result.busy){try{result.attendanceRefresh=await attendanceImporter.run(staff.gym_id,staff.user_id);}catch(e){result.attendanceRefresh={success:false,error:e.message};}}
      res.json(result);
    }catch(e){if(e.schemaMissing)e.message='Run migration 008 before syncing.';if(!e.status)e.status=503;next(e);}
  });
  // Delivery uses a staff session or the dedicated local operations identity.
  let autoSyncRunning=false;
  const secondaryTimer=!process.env.VERCEL&&setInterval(async()=>{
    if(autoSyncRunning||(!process.env.FALLBACK_SPREADSHEET_ID&&process.env.SUPABASE_DEVICE_SYNC_ENABLED!=='1'))return;
    autoSyncRunning=true;
    try{for(const id of [...sessions.keys(),...(process.env.OPEN_OPERATIONS_ENABLED==='1'?[null]:[])]){let auth;
      try{auth=id===null?await openOperation({headers:{},socket:{remoteAddress:'127.0.0.1'}}):await authenticated({headers:{cookie:`${COOKIE}=${id}`}});}catch{continue;}
      if(!['admin','receptionist'].includes(auth.staff.role))continue;
      for(const destination of ['google_sheets','fingerprint']){
        if(destination==='google_sheets'&&!process.env.FALLBACK_SPREADSHEET_ID)continue;
        if(destination==='fingerprint'&&process.env.SUPABASE_DEVICE_SYNC_ENABLED!=='1')continue;
        try{await bridge.run({gymId:auth.staff.gym_id,token:auth.session.accessToken,destination});}catch(error){console.error('Secondary sync:',destination,error.message);}
      }
      break;
    }}finally{autoSyncRunning=false;}
  },15000);if(secondaryTimer)secondaryTimer.unref();
  if(!process.env.VERCEL&&process.env.OPEN_OPERATIONS_ENABLED==='1')cloudBridge.startWorker({getContext:()=>openOperation({headers:{},socket:{remoteAddress:'127.0.0.1'}}),bridge,attendanceImporter});
  router.post('/import-snapshot',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      const payload=JSON.parse(fs.readFileSync(path.join(__dirname,'..','migration-data','real-data','snapshot.json'),'utf8'));
      if(staff.gym_id!==payload.gym_id)throw Object.assign(new Error('This spreadsheet belongs to a different gym.'),{status:403});
      const result=await request('/rest/v1/rpc/import_gym_snapshot',{method:'POST',token:session.accessToken,timeout:120000,body:{target_gym:staff.gym_id,payload}});
      res.json({success:true,...result});
    }catch(e){if(e.schemaMissing)e.message='Run the management setup SQL before importing.';next(e);}
  });
  function uuid(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value)))throw Object.assign(new Error('Invalid record identifier.'),{status:400});return value;}
  router.get(['/member-lookup','/pt-member-lookup'],async(req,res,next)=>{
    try{const {staff,session}=await operational(req,{publicForm:true});requireRole(staff,['admin','receptionist']);
      const id=String(req.query.admissionId||'').trim().toUpperCase();const mobile=String(req.query.mobile||'').replace(/\D/g,'');
      if(!id&&!mobile)throw Object.assign(new Error('Enter an admission ID or mobile number.'),{status:400});
      if(id&&!/^[A-Z]+-\d+$/.test(id))throw Object.assign(new Error('Invalid admission ID.'),{status:400});
      const filter=id?`admission_id=eq.${encodeURIComponent(id)}`:`phone=eq.${encodeURIComponent(mobile)}`;
      const members=await rows('members',`select=id,admission_id,full_name,phone&gym_id=eq.${staff.gym_id}&${filter}&is_archived=eq.false&order=id.asc`,session.accessToken);
      if(members.length>1)throw Object.assign(new Error('More than one member uses that phone. Search by admission ID.'),{status:409});
      if(!members.length)return res.json({success:false,message:'No member found in Supabase. Import existing members first, or check the admission ID.'});
      const member=members[0];
      if(req.path==='/pt-member-lookup')return res.json({member});
      const periods=await request(`/rest/v1/memberships?select=end_date,plan_id&gym_id=eq.${staff.gym_id}&member_id=eq.${member.id}&status=eq.confirmed&order=end_date.desc&limit=1`,{token:session.accessToken});
      const latest=periods[0];let plan='No membership';
      if(latest){const plans=await request(`/rest/v1/membership_plans?select=name&id=eq.${latest.plan_id}&gym_id=eq.${staff.gym_id}`,{token:session.accessToken});plan=plans[0]?.name||'Customize Package';}
      res.json({success:true,name:member.full_name,admissionId:member.admission_id,mobile:member.phone,plan,endDate:latest?.end_date?.split('-').reverse().join('-')||''});
    }catch(e){next(e);}
  });
  router.get('/member-details',async(req,res,next)=>{
    try{const {staff,session}=await operational(req);requireRole(staff,['admin','receptionist']);
      const code=String(req.query.admissionId||'').trim().toUpperCase(),phone=String(req.query.mobile||'').replace(/\D/g,'');
      if(code?!/^[A-Z]+-\d+$/.test(code):!/^\d{10,15}$/.test(phone))throw Object.assign(new Error('Enter a valid admission ID or phone number.'),{status:400});
      const gym=`gym_id=eq.${staff.gym_id}`;
      const found=await rows('members',`select=id,admission_id,full_name,phone&${gym}&is_archived=eq.false&${code?'admission_id':'phone'}=eq.${encodeURIComponent(code||phone)}&order=id.asc`,session.accessToken);
      if(found.length!==1)throw Object.assign(new Error(found.length?'Multiple members use this phone. Search by admission ID.':'Member not found in Supabase.'),{status:found.length?409:404});
      const member=found[0];const [periods,plans,payments]=await Promise.all([
        rows('memberships',`select=id,plan_id,start_date,end_date,final_amount,historical_charge,opening_paid_amount,accounting_verified&${gym}&member_id=eq.${member.id}&status=eq.confirmed&order=end_date.desc,id.asc`,session.accessToken),
        rows('membership_plans',`select=id,code,name,is_active&${gym}&order=id.asc`,session.accessToken),
        rows('payments',`select=membership_id,amount,kind&${gym}&order=id.asc`,session.accessToken)]);
      res.json({member,plans,periods:periods.map(p=>({...p,plan_name:plans.find(x=>x.id===p.plan_id)?.name||'Custom package',outstanding:p.accounting_verified===false?null:Math.max(0,Number(p.final_amount??p.historical_charge)-Number(p.opening_paid_amount||0)-payments.filter(x=>x.membership_id===p.id).reduce((s,x)=>s+Number(x.amount)*(x.kind==='refund'?-1:1),0))}))});
    }catch(e){next(e);}
  });
  router.get('/pt-trainers',async(req,res,next)=>{
    try{const {staff,session}=await operational(req,{publicForm:true});requireRole(staff,['admin','receptionist']);res.json(await rows('pt_trainers',`select=id,name&gym_id=eq.${staff.gym_id}&is_active=eq.true&order=name.asc`,session.accessToken));}
    catch(e){if(e.schemaMissing)e.message='Run migration 006 before using Personal Training.';next(e);}
  });
  router.post('/member-command',async(req,res,next)=>{
    try{const {staff,session}=await operational(req,{publicForm:req.body?.command==='pt'});requireRole(staff,['admin','receptionist']);
      const {command,payload,requestId}=req.body;
      if(!['profile','membership','payment','pt','pt_payment'].includes(command)||!payload||typeof payload!=='object'||Array.isArray(payload))throw Object.assign(new Error('Invalid member form.'),{status:400});
      const result=await request('/rest/v1/rpc/manage_member_form',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(requestId),command,payload}});res.json(result);
    }catch(e){if(e.schemaMissing){e.status=503;e.message='Run migration 006 (member updates and Personal Training) before saving.';}next(e);}
  });
  router.post('/form-submit',async(req,res,next)=>{
    try{const {staff,session}=await operational(req,{publicForm:true});requireRole(staff,['admin','receptionist']);const b=req.body;
      if(b.action==='enquire'){
        const payload={full_name:String(b.name||'').trim(),phone:String(b.contact||b.mobile||'').replace(/\D/g,''),email:String(b.email||'').trim(),address:String(b.address||'').trim(),interested_plan:String(b.interestedIn||''),source:String(b.source||''),follow_up_date:b.followUpDate||null,notes:String(b.message||'')};
        if(!payload.full_name||!/^\d{10,15}$/.test(payload.phone)||(payload.follow_up_date&&!validDate(payload.follow_up_date)))throw Object.assign(new Error('Enter a name, valid phone and valid optional follow-up date.'),{status:400});
        return res.json(await request('/rest/v1/rpc/submit_enquiry',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(b.requestId),payload}}));
      }
      if(!['admission','saveRenewal'].includes(b.action))throw Object.assign(new Error('Invalid form action.'),{status:400});
      if(!validDate(b.startDate)||!validDate(b.endDate)||b.endDate<b.startDate)throw Object.assign(new Error('Choose valid membership dates.'),{status:400});
      if(b.plan==='custom'&&b.customDays!==undefined&&packageEndDate(b.startDate,Number(b.customDays))!==b.endDate)
        throw Object.assign(new Error('Enter a positive whole number of package days. The end date must match the selected duration.'),{status:400});
      const gross=Number(b.totalAmount??b.amount),discount=Number(b.discount||0),final=Number(b.finalAmount),paid=Number(b.amountPaid),pending=Number(b.pendingAmount);
      if([gross,discount,final,paid,pending].some(n=>!Number.isFinite(n)||n<0)||final<=0||Math.abs(gross-discount-final)>0.005||Math.abs(paid+pending-final)>0.005)throw Object.assign(new Error('The charge, discount, paid amount and pending amount do not balance.'),{status:400});
      const kind=b.action==='admission'?'admission':'renewal';
      const code=packageGroup({start_date:b.startDate,end_date:b.endDate},{code:b.plan==='custom'?'custom':undefined});
      const plans=await rows('membership_plans',`select=id&gym_id=eq.${staff.gym_id}&code=eq.${code}&is_active=eq.true&order=id.asc`,session.accessToken);
      if(!plans[0])throw Object.assign(new Error('This package is not configured. Run the direct-forms setup SQL.'),{status:503});
      const payload={kind,plan_id:plans[0].id,start_date:b.startDate,end_date:b.endDate,total_amount:gross,discount_amount:discount,paid_amount:paid,payment_mode:String(b.paymentMode||'')};
      if(paid>0&&!payload.payment_mode)throw Object.assign(new Error('Select the payment method.'),{status:400});
      const mixed=payload.payment_mode==='Cash + Online';
      if(mixed){
        const cash=Number(b.cashCollected),online=Number(b.onlineCollected);
        if([cash,online].some(n=>!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>0.000001)||Math.abs(cash+online-paid)>0.005)throw Object.assign(new Error('Cash and online must be positive amounts and add up to the amount received.'),{status:400});
        payload.cash_collected=cash;payload.online_collected=online;
      }
      if(kind==='admission'){
        const phone=String(b.mobile||'').replace(/\D/g,'');
        if(!/^\d{10,15}$/.test(phone))throw Object.assign(new Error('Enter a valid phone number, including country code if needed.'),{status:400});
        if(b.birthDate&&(!validDate(b.birthDate)||memberAgeOn(b.birthDate)===null))throw Object.assign(new Error('Enter a valid birth date, today or earlier.'),{status:400});
        if(b.birthDate)b.age=String(memberAgeOn(b.birthDate));
        Object.assign(payload,{full_name:String(b.name||'').trim(),phone,category:String(b.category||''),gender:String(b.gender||''),age:String(b.age||''),birth_date:String(b.birthDate||''),address:String(b.address||''),medical_history:String(b.injuries||''),remarks:String(b.remarks||'')});
      }
      else{
        const admissionId=String(b.admissionId||'').trim().toUpperCase();
        if(!/^[A-Z]+-\d+$/.test(admissionId))throw Object.assign(new Error('Choose an existing admission ID.'),{status:400});
        const member=await rows('members',`select=id&gym_id=eq.${staff.gym_id}&admission_id=eq.${encodeURIComponent(admissionId)}&is_archived=eq.false&order=id.asc`,session.accessToken);
        if(!member[0])throw Object.assign(new Error('Member not found in Supabase. Import existing members before renewing.'),{status:404});payload.member_id=member[0].id;
      }
      const result=await request('/rest/v1/rpc/'+(mixed?'submit_split_gym_form':'submit_gym_form'),{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(b.requestId),payload}});
      res.json(result);
    }catch(e){if(e.schemaMissing){e.status=503;e.message=req.body?.paymentMode==='Cash + Online'?'Run migration 007 (split payments) before saving Cash + Online.':req.body?.action==='enquire'?'Run migration 005 (enquiries and leads) before saving enquiries.':'Run the management and direct-forms setup SQL before submitting.';}next(e);}
  });
  router.post('/memberships',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      const {requestId,...payload}=req.body;
      const result=await request('/rest/v1/rpc/submit_gym_form',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(requestId),payload}});res.json({id:result.membershipId});
    }catch(e){if(e.schemaMissing)e.message='Run the management and direct-forms setup SQL before saving records.';next(e);}
  });
  router.post('/payments',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      const id=await request('/rest/v1/rpc/record_payment',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,payload:req.body}});res.json({id});
    }catch(e){next(e);}
  });
  router.post('/staff',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      const input=staffAccountInput(req.body);
      await request('/rest/v1/rpc/staff_account_setup_ready',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id}});
      const result=await createStaffAccount({input,gymId:staff.gym_id,fetchImpl});
      res.status(201).json({success:true,userId:result.userId,role:input.role});
    }catch(e){if(e.schemaMissing){e.status=503;e.message='Run migration 013 (staff accounts) before creating staff logins.';}next(e);}
  });
  router.patch('/staff/:id',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      const body={};if(req.body.role!==undefined){if(!['admin','receptionist','trainer'].includes(req.body.role))throw Object.assign(new Error('Invalid role.'),{status:400});body.role=req.body.role;}
      if(req.body.is_active!==undefined){if(typeof req.body.is_active!=='boolean')throw Object.assign(new Error('Invalid staff status.'),{status:400});body.is_active=req.body.is_active;}
      if(req.body.full_name!==undefined){body.full_name=String(req.body.full_name).trim();if(!body.full_name)throw Object.assign(new Error('Staff name is required.'),{status:400});}
      const result=await request(`/rest/v1/staff?id=eq.${uuid(req.params.id)}&gym_id=eq.${staff.gym_id}`,{method:'PATCH',token:session.accessToken,headers:{Prefer:'return=representation'},body});
      if(!result.length)throw Object.assign(new Error('Staff record not found.'),{status:404});res.json({staff:result[0]});
    }catch(e){if(e.detail?.includes('last active administrator'))e.message=e.detail;next(e);}
  });
  router.delete('/staff/:id',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      // Remove access without deleting the Auth account or breaking payment/audit history.
      const result=await request(`/rest/v1/staff?id=eq.${uuid(req.params.id)}&gym_id=eq.${staff.gym_id}`,{method:'PATCH',token:session.accessToken,headers:{Prefer:'return=representation'},body:{is_active:false}});
      if(!result.length)throw Object.assign(new Error('Staff record not found.'),{status:404});res.json({success:true});
    }catch(e){if(e.detail?.includes('last active administrator'))e.message=e.detail;next(e);}
  });
  router.post('/expenses',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      const b=req.body;const amount=Number(b.amount);
      if(!Number.isFinite(amount)||amount<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.expense_date)||!String(b.category||'').trim()||!String(b.description||'').trim())throw Object.assign(new Error('Enter a valid date, category, description and positive amount.'),{status:400});
      const result=await request('/rest/v1/expenses',{method:'POST',token:session.accessToken,headers:{Prefer:'return=representation'},body:{gym_id:staff.gym_id,created_by:staff.id,expense_date:b.expense_date,category:String(b.category).trim(),description:String(b.description).trim(),amount,payment_mode:b.payment_mode||'Cash'}});res.json({expense:result[0]});
    }catch(e){next(e);}
  });
  router.delete('/expenses/:id',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      await request(`/rest/v1/expenses?id=eq.${uuid(req.params.id)}&gym_id=eq.${staff.gym_id}`,{method:'PATCH',token:session.accessToken,body:{status:'void'}});res.json({success:true});
    }catch(e){next(e);}
  });
  router.post('/enquiries',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);const b=req.body;
      if(!String(b.full_name||'').trim()||!String(b.phone||'').trim())throw Object.assign(new Error('Name and phone are required.'),{status:400});
      if(b.follow_up_date&&!validDate(b.follow_up_date))throw Object.assign(new Error('Invalid follow-up date.'),{status:400});
      const payload={full_name:String(b.full_name).trim(),phone:String(b.phone).replace(/\D/g,''),email:b.email||null,address:b.address||null,interested_plan:b.interested_plan||null,source:b.source||null,follow_up_date:b.follow_up_date||null,notes:b.notes||null};
      res.json(await request('/rest/v1/rpc/submit_enquiry',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,request_uuid:uuid(b.requestId),payload}}));
    }catch(e){next(e);}
  });
  router.patch('/enquiries/:id',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      const b=req.body;
      if(!['Pending','Call Done','WhatsApp Sent','Trial Done','Admission Done','Call Later','Not Interested','Wrong Number'].includes(b.lead_status))throw Object.assign(new Error('Invalid lead status.'),{status:400});
      if(b.next_follow_up_date&&!validDate(b.next_follow_up_date))throw Object.assign(new Error('Invalid next follow-up date.'),{status:400});
      res.json(await request('/rest/v1/rpc/update_enquiry_followup',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,target_lead:uuid(req.params.id),payload:{lead_status:b.lead_status,next_follow_up_date:b.next_follow_up_date||null,remark:String(b.remark||'')}}}));
    }catch(e){next(e);}
  });
  router.get('/enquiries/:id/history',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin','receptionist']);
      const history=await rows('enquiry_followups',`select=id,from_status,to_status,next_follow_up_date,remark,created_at&gym_id=eq.${staff.gym_id}&enquiry_id=eq.${uuid(req.params.id)}&order=created_at.desc,id.desc`,session.accessToken);res.json({history});
    }catch(e){next(e);}
  });
  function enquirySnapshot(staff){
    const p=JSON.parse(fs.readFileSync(path.join(__dirname,'..','migration-data','enquiries','prepared.json'),'utf8'));
    if(p.gym_id!==staff.gym_id)throw Object.assign(new Error('The source snapshot belongs to a different gym.'),{status:403});return p;
  }
  router.post('/enquiries/import-history',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      res.json(await request('/rest/v1/rpc/import_enquiry_snapshot',{method:'POST',token:session.accessToken,timeout:120000,body:{target_gym:staff.gym_id,payload:enquirySnapshot(staff)}}));
    }catch(e){next(e);}
  });
  router.post('/pending/reconcile',async(req,res,next)=>{
    try{const {staff,session}=await authenticated(req);requireRole(staff,['admin']);
      res.json(await request('/rest/v1/rpc/reconcile_pending_snapshot',{method:'POST',token:session.accessToken,body:{target_gym:staff.gym_id,payload:{balances:enquirySnapshot(staff).balances}}}));
    }catch(e){next(e);}
  });
  router.use((error, req, res, next) => {
    res.status(error.status >= 400 && error.status <= 599 ? error.status : 500).json({ error: error.status ? error.message : 'Unable to complete this request. Please try again.' });
  });
  return router;
}

module.exports = { createDashboardRouter };
