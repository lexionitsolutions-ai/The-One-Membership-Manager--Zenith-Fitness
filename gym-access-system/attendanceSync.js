const { connectDevice } = require('./device');
const { getMembers, appendAttendanceRows } = require('./sheets');
const { formatDate, isMembershipActive } = require('./accessPolicy');

let lastProcessedTime = null;
let isSyncing = false;
let baselineReady = false;

const SAVE_ATTENDANCE = process.env.SAVE_ATTENDANCE === '1';
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === '1';

function logVerbose(message) {
  if (VERBOSE_LOGS) console.log(message);
}

function normalizeNumericId(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

async function safeDisconnect(zk) {
  if (!zk) return;

  try {
    await zk.disconnect();
  } catch (err) {
    logVerbose(`Disconnect skipped: ${err?.message || err}`);
  }
}

function buildMemberMap(members) {
  const memberMap = new Map();

  for (const member of members) {
    if (member.userId) {
      memberMap.set(String(member.userId).trim(), member);
      memberMap.set(normalizeNumericId(member.userId), member);
    }

    if (member.sheetId) {
      memberMap.set(String(member.sheetId).trim(), member);
      memberMap.set(normalizeNumericId(member.sheetId), member);
    }
  }

  return memberMap;
}

function readPunchDate(log) {
  const punchDate = new Date(log.recordTime || '');
  return isNaN(punchDate.getTime()) ? null : punchDate;
}

async function setAttendanceBaseline(logs) {
  for (const log of logs) {
    const punchDate = readPunchDate(log);

    if (punchDate && (!lastProcessedTime || punchDate > new Date(lastProcessedTime))) {
      lastProcessedTime = log.recordTime;
    }
  }

  baselineReady = true;
  logVerbose(`Attendance baseline set at ${lastProcessedTime || 'latest device log'}`);
}

async function syncAttendance() {
  if(process.env.LEGACY_SHEETS_MODE!=='1')return;
  if (isSyncing) {
    logVerbose('Previous attendance sync still running, skipping this cycle...');
    return;
  }

  isSyncing = true;
  let zk = null;

  try {
    zk = await connectDevice();

    if (!zk) {
      console.log('Could not connect to device');
      return;
    }

    const attendance = await zk.getAttendances();
    const logs = attendance?.data || [];

    if (!baselineReady) {
      await setAttendanceBaseline(logs);
      return;
    }

    if (!logs.length) return;

    const members = await getMembers();
    const memberMap = buildMemberMap(members);
    const rowsToAppend = [];
    let newestProcessedTime = lastProcessedTime;

    for (const log of logs) {
      const punchTime = log.recordTime || 'Unknown Time';
      const punchDate = readPunchDate(log);

      if (punchDate && lastProcessedTime && punchDate <= new Date(lastProcessedTime)) {
        continue;
      }

      const rawDeviceId = String(
        log.deviceUserId || log.userId || log.uid || ''
      ).trim();

      const numericDeviceId = normalizeNumericId(rawDeviceId);
      const member = memberMap.get(rawDeviceId) || memberMap.get(numericDeviceId);

      if (!member) {
        console.log(
          `ENTRY RESTRICTED | Unknown member | Device ID: ${rawDeviceId} | Punch: ${punchTime}`
        );

        rowsToAppend.push([
          punchTime,
          rawDeviceId,
          '',
          'Unknown Member',
          '',
          'Restricted',
        ]);
      } else if (isMembershipActive(member)) {
        console.log(
          `ENTRY ALLOWED | ${member.name} (${member.sheetId || ''}) | valid until ${formatDate(member.endDate)} | Punch: ${punchTime}`
        );

        rowsToAppend.push([
          punchTime,
          rawDeviceId,
          member.sheetId || '',
          member.name || '',
          formatDate(member.endDate),
          'Allowed',
        ]);
      } else {
        console.log(
          `ENTRY RESTRICTED | ${member.name} (${member.sheetId || ''}) | expired on ${formatDate(member.endDate)} | Punch: ${punchTime}`
        );

        rowsToAppend.push([
          punchTime,
          rawDeviceId,
          member.sheetId || '',
          member.name || '',
          formatDate(member.endDate),
          'Restricted',
        ]);
      }

      if (punchDate && (!newestProcessedTime || punchDate > new Date(newestProcessedTime))) {
        newestProcessedTime = punchTime;
      }
    }

    if (rowsToAppend.length > 0) {
      if (SAVE_ATTENDANCE && typeof appendAttendanceRows === 'function') {
        await appendAttendanceRows(rowsToAppend);
        logVerbose(`${rowsToAppend.length} new attendance rows saved to Google Sheets`);
      } else {
        logVerbose(`${rowsToAppend.length} attendance rows processed`);
      }

      lastProcessedTime = newestProcessedTime;
    }
  } catch (err) {
    console.error('Attendance sync error:', err.message || err);
  } finally {
    await safeDisconnect(zk);
    isSyncing = false;
  }
}

async function startAttendanceSync() {
  if(process.env.LEGACY_SHEETS_MODE!=='1'){console.log('Legacy Sheets attendance loop is retired.');return;}
  logVerbose('Live attendance sync started');

  while (true) {
    await syncAttendance();
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

if (require.main === module) {
  startAttendanceSync();
}

module.exports = {
  startAttendanceSync,
  syncAttendance,
};
