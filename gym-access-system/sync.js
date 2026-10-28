const { getMembers } = require('./sheets');
const { createUser } = require('./createUser');
const { connectDevice } = require('./device');
const cron = require('node-cron');
const { isMembershipActive } = require('./accessPolicy');

cron.schedule('0 2 * * *', () => {
  console.log('Running daily sync...');
  syncUsers();
});

async function syncUsers() {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy Sheets device sync is retired. Use Supabase secondary sync.');
  const zk = await connectDevice();

  if (!zk) {
    console.log('Sync stopped because device connection failed');
    return;
  }

  try {
    await zk.disableDevice();

    const members = await getMembers();

    for (const user of members) {
      if (!user.uid) {
        console.log(`Skipping invalid ID: ${user.name}`);
        continue;
      }

      console.log(`${user.name} [${user.sheetId}] Expiry: ${user.endDate?.toDateString()}`);

      if (!isMembershipActive(user)) {
        console.log(`Inactive member detected: ${user.name} (${user.sheetId} -> ${user.userId})`);
        continue;
      }

      await createUser(zk, user);
    }

    await zk.enableDevice();
    await zk.disconnect();
  } catch (err) {
    console.error('Sync Error:', err);
  }
}

syncUsers().catch(error=>console.error(error.message));
