const crypto=require('node:crypto');const COOKIE='zenith_forms_access';
function accessToken(env=process.env){const secret=env.PORTAL_SESSION_SECRET,gym=env.OPEN_OPERATIONS_GYM_ID;if(!secret||secret.length<32||!gym)throw Object.assign(new Error('Private staff links are not configured.'),{status:503});return crypto.createHmac('sha256',secret).update('zenith-private-forms-v1:'+gym).digest('base64url');}
function validToken(value,env=process.env){if(typeof value!=='string')return false;let expected;try{expected=accessToken(env);}catch{return false;}const a=Buffer.from(value),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function hasFormsAccess(req,env=process.env){const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return validToken(value,env);}
function grantFormsAccess(req,res){res.cookie(COOKIE,accessToken(),{httpOnly:true,secure:req.secure,sameSite:'lax',path:'/',maxAge:400*86400000});}
module.exports={accessToken,validToken,hasFormsAccess,grantFormsAccess};
