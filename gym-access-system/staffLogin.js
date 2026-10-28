// Contact numbers are login aliases; Supabase continues to verify the password.
function resolveStaffLogin(value, env = process.env) {
  const login = String(value ?? '').trim();
  if (login.includes('@')) return login;
  let phone = login.replace(/[\s()-]/g, '');
  if (/^(?:\+91|91)\d{10}$/.test(phone)) phone = phone.slice(-10);
  if (phone === '8999699811') {
    const email = String(env.SUPABASE_ADMIN_LOGIN_EMAIL || '').trim();
    if (!email || !email.includes('@')) throw Object.assign(new Error('Admin contact login is awaiting configuration. Use your existing admin email to sign in.'), {status:503});
    return email;
  }
  return /^\d{10,15}$/.test(phone) ? phone + '@staff.zenith.local' : login;
}
module.exports = {resolveStaffLogin};
