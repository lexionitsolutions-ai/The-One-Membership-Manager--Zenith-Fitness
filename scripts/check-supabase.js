// Read-only connectivity check. Does not sign in or change any records.
async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env');
  const base = new URL(url);
  if (base.protocol !== 'https:' || !key.startsWith('sb_publishable_')) {
    throw new Error('Expected an HTTPS Supabase URL and a publishable key');
  }

  const headers = { apikey: key };
  const settings = await fetch(new URL('/auth/v1/settings', base), {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!settings.ok) throw new Error(`Supabase Auth check returned HTTP ${settings.status}`);
  console.log('PASS: Supabase Auth is reachable and accepts the publishable key.');

  const members = await fetch(new URL('/rest/v1/members?select=id&limit=1', base), {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (![401, 403].includes(members.status)) {
    throw new Error(`Expected anonymous member access to be denied; received HTTP ${members.status}`);
  }
  console.log('PASS: Anonymous member access is denied.');
  console.log('No records changed. Staff login and data import are not configured by this check.');
}

main().catch((error) => {
  console.error(`Supabase check failed: ${error.message}`);
  if (error.cause?.code) console.error(`Network error: ${error.cause.code}`);
  process.exitCode = 1;
});
