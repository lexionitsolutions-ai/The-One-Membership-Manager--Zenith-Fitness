const cron = require('node-cron');
const { connectDevice } = require('./device');
const { getMembers } = require('./sheets');
const {
  allowUserAccess,
  ensureAccessTimezones,
  restrictUserAccess,
  refreshDevice,
} = require('./accessControl');
const {
  formatDate,
  isMembershipActive,
  isMembershipExpired,
  parseDate,
} = require('./accessPolicy');

let syncRunning = false;
let currentSyncStartedAt = null;
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === '1';
const SYNC_STEP_TIMEOUT_MS = Number(process.env.SYNC_STEP_TIMEOUT_MS || 30000);

function logVerbose(message) {
  if (VERBOSE_LOGS) console.log(message);
}

function getSyncStatus() {
  return {
    running: syncRunning,
    startedAt: currentSyncStartedAt,
  };
}

async function withTimeout(promise, label, timeoutMs = SYNC_STEP_TIMEOUT_MS) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeDisconnect(zk) {
  try {
    if (zk) await withTimeout(zk.disconnect(), 'Device disconnect', 5000);
  } catch {}
}

async function createOrUpdateUser(zk, member) {
  await withTimeout(
    zk.setUser(
      Number(member.uid),
      String(member.userId),
      String(member.name),
      '',
      0,
      0
    ),
    `Create/update member ${member.sheetId || member.uid}`
  );
}

function buildDeviceUserMaps(deviceUsers) {
  const byUid = new Map();
  const byUserId = new Map();

  for (const user of deviceUsers) {
    const uid = Number(user.uid || 0);
    const userId = String(user.userId || '').trim();

    if (uid) byUid.set(uid, user);
    if (userId) byUserId.set(userId, user);
  }

  return { byUid, byUserId };
}

function getSyncTargetDate(options = {}) {
  const target = parseDate(options.asOf || options.targetDate);
  return target || new Date();
}

async function fullSyncToDevice(options = {}) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')return {success:false,message:'Legacy Sheets device sync is disabled. Use the signed-in Supabase dashboard Activity & sync page.'};
  if (syncRunning) {
    return {
      success: false,
      alreadyRunning: true,
      message: 'A device sync is already running. Please wait a moment.',
      startedAt: currentSyncStartedAt,
    };
  }

  syncRunning = true;
  currentSyncStartedAt = new Date().toISOString();

  let zk = null;
  const syncAsOf = getSyncTargetDate(options);

  try {
    logVerbose(`Starting full member access sync for ${formatDate(syncAsOf)}...`);

    const members = await withTimeout(getMembers(), 'Reading Google Sheets', 60000);
    logVerbose(`Members loaded from sheets: ${members.length}`);

    zk = await withTimeout(connectDevice(), 'Device connection');

    if (!zk) {
      console.log('Could not connect to device');
      return {
        success: false,
        message: 'Could not connect to device',
      };
    }

    const usersResponse = await withTimeout(zk.getUsers(), 'Reading device users');
    const deviceUsers = usersResponse?.data || [];
    const { byUid, byUserId } = buildDeviceUserMaps(deviceUsers);
    await withTimeout(ensureAccessTimezones(zk), 'Preparing device access rules');

    let createdOrUpdated = 0;
    let restoredActive = 0;
    let restrictedExpired = 0;
    let restrictedInactive = 0;
    let restrictedUnknown = 0;

    for (const member of members) {
      const uid = Number(member.uid);
      const userId = String(member.userId || '').trim();

      if (!uid || !userId) continue;

      const existing = byUid.get(uid) || byUserId.get(userId);
      const deviceName = String(existing?.name || '').trim();
      const deviceCardNo = Number(existing?.cardno || 0);
      const memberName = String(member.name || '').trim();
      const needsCreateOrUpdate = !existing || deviceName !== memberName || deviceCardNo !== 0;

      if (needsCreateOrUpdate) {
        await createOrUpdateUser(zk, member);
        createdOrUpdated++;
      }

      if (!isMembershipActive(member, syncAsOf)) {
        try {
          await withTimeout(restrictUserAccess(zk, uid), `Restricting inactive member ${member.sheetId || uid}`);
          if (isMembershipExpired(member.endDate, syncAsOf)) {
            restrictedExpired++;
          } else {
            restrictedInactive++;
          }
        } catch (err) {
          console.log(`Failed restricting inactive member ${member.sheetId}: ${err.message}`);
        }

        continue;
      }

      try {
        await withTimeout(allowUserAccess(zk, uid), `Allowing active member ${member.sheetId || uid}`);
        restoredActive++;
      } catch (err) {
        console.log(`Failed restoring active member ${member.sheetId}: ${err.message}`);
      }
    }

    const knownMemberUids = new Set(
      members
        .map(member => Number(member.uid))
        .filter(Boolean)
    );

    for (const deviceUser of deviceUsers) {
      const uid = Number(deviceUser.uid || 0);
      if (!uid || knownMemberUids.has(uid)) continue;

      try {
        await withTimeout(restrictUserAccess(zk, uid), `Restricting unknown device user UID ${uid}`);
        restrictedUnknown++;
      } catch (err) {
        console.log(`Failed restricting unknown device user UID ${uid}: ${err.message}`);
      }
    }

    await withTimeout(refreshDevice(zk), 'Refreshing device data');

    const summary = {
      success: true,
      message: 'Device sync complete',
      synced: createdOrUpdated,
      activeAllowed: restoredActive,
      expiredRestricted: restrictedExpired,
      inactiveRestricted: restrictedInactive,
      unknownRestricted: restrictedUnknown,
      totalMembers: members.length,
      syncAsOf: formatDate(syncAsOf),
      completedAt: new Date().toISOString(),
    };

    logVerbose(
      `Access sync complete | synced: ${summary.synced} | active allowed: ${summary.activeAllowed} | expired restricted: ${summary.expiredRestricted} | inactive restricted: ${summary.inactiveRestricted} | unknown restricted: ${summary.unknownRestricted}`
    );

    return summary;
  } catch (err) {
    const message = err.message || String(err);
    console.log('Full sync error:', message);

    return {
      success: false,
      message,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await safeDisconnect(zk);
    syncRunning = false;
    currentSyncStartedAt = null;
  }
}

function startMemberSyncLoop() {
  logVerbose('Member access sync loop started');
  setInterval(() => fullSyncToDevice(), 60000);
}

function startScheduledJobs() {
  cron.schedule('0 20 * * *', () => {
    logVerbose('8 PM access sync');
    fullSyncToDevice();
  });
}

async function runStartupSync() {
  await fullSyncToDevice();
}

module.exports = {
  startScheduledJobs,
  startMemberSyncLoop,
  runStartupSync,
  fullSyncToDevice,
  getSyncStatus,
};
