const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
const envPath=path.join(__dirname,'..','.env');
if(!process.env.VERCEL&&fs.existsSync(envPath))process.loadEnvFile(envPath);
const {createDashboardRouter}=require('./dashboardRoutes');
const {PersistentSessions}=require('./persistentSessions');
const {CloudRuntimeStore}=require('./cloudRuntime');
const {validToken,hasFormsAccess,grantFormsAccess}=require('./formsAccess');
const app=express();
const PORT=Number(process.env.PORT||3001);
if(process.env.VERCEL)app.set('trust proxy',1);
app.use(express.json());
app.use(express.urlencoded({extended:false}));
const privateDirectory=path.join(__dirname,'..','runtime-private');
app.use('/api/portal',createDashboardRouter({sessionStore:process.env.VERCEL?new CloudRuntimeStore('sessions'):new PersistentSessions(privateDirectory),operationStore:process.env.VERCEL?new CloudRuntimeStore('operations'):new PersistentSessions(privateDirectory,'operations')}));
app.get('/staff-access/:token',(req,res)=>{if(!validToken(req.params.token))return res.status(403).send('This private staff link is invalid. Ask your administrator for the current link.');grantFormsAccess(req,res);res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.redirect('/forms/index.html');});
if(process.env.VERCEL)app.use(['/forms','/fingerprint'],(req,res,next)=>{if(hasFormsAccess(req))return next();res.status(403).type('html').send('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenith staff access</title><body style="font:18px/1.6 Arial;padding:40px;max-width:620px;margin:auto;color:#253149"><h1>Private staff access</h1><p>Open the private staff link provided by your administrator, or sign in to the staff dashboard to use the forms.</p><a href="/dashboard/">Staff sign-in</a></body></html>');});
app.use('/fingerprint',express.static(path.join(__dirname,'public','fingerprint')));
app.use('/dashboard',express.static(path.join(__dirname,'public','dashboard')));
app.use('/forms/assets',express.static(path.join(__dirname,'..','assets')));
app.get('/forms/:file',(req,res)=>{
 const allowed=['index.html','renewal.html','enquire.html','update.html','style.css','renewal.css','script.js','renewal.js','enquire.js','update.js','dashboard-form-sync.js','forms-modern.css','forms-ui.js','split-payment.js','member-forms.js','pt.html','pt.js','package-dates.js','member-dates.js'];
 if(!allowed.includes(req.params.file))return res.sendStatus(404);
 res.sendFile(path.join(__dirname,'..',req.params.file));
});
app.get('/health',(req,res)=>res.json({success:true,message:'Server is running',primaryDatabase:'supabase'}));
app.get('/',(req,res)=>res.redirect(process.env.VERCEL?'/dashboard/':'/fingerprint/'));
app.get('/sync-access/status',(req,res)=>res.json({success:true,mode:'supabase',legacySheetsSyncDisabled:true}));
for(const route of ['/admission-submit','/sync-access','/admin/sync-members','/device/add-user']){
 app.post(route,(req,res)=>res.status(410).json({success:false,message:'Legacy Sheets/device writes are retired. Use the signed-in Supabase staff dashboard.'}));
}
app.get('/attendance',(req,res)=>res.status(410).json({success:false,message:'Use the signed-in Supabase dashboard attendance page.'}));
if(require.main===module&&!process.env.VERCEL)app.listen(PORT,()=>{
 console.log('Web server running at http://localhost:'+PORT);
 console.log('Supabase is primary. Secondary delivery runs with active staff sessions; legacy Sheets/device jobs are disabled.');
});
module.exports=app;
