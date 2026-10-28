const { COMMANDS } = require('zklib-js/constants');

const ACCESS_TZ_ALLOWED = Number(process.env.ACCESS_TZ_ALLOWED || 1);
const ACCESS_TZ_BLOCKED = Number(process.env.ACCESS_TZ_BLOCKED || 50);

async function refreshDevice(zk) {
  try {
    await zk.executeCmd(COMMANDS.CMD_REFRESHDATA, '');
  } catch {}
}

async function writeUserTimezone(zk, uid, tz1, tz2 = 0, tz3 = 0) {
  const numericUid = Number(uid);
  if (!numericUid) {
    throw new Error(`Invalid UID: ${uid}`);
  }

  const payload = Buffer.alloc(20);
  payload.writeUInt32LE(numericUid, 0);
  payload.writeUInt32LE(1, 4);
  payload.writeUInt32LE(Number(tz1), 8);
  payload.writeUInt32LE(Number(tz2), 12);
  payload.writeUInt32LE(Number(tz3), 16);

  await zk.executeCmd(COMMANDS.CMD_USERTZ_WRQ, payload);
}

async function writeAlwaysClosedTimezone(zk, timezoneId = ACCESS_TZ_BLOCKED) {
  const payload = Buffer.alloc(32);
  payload.writeUInt32LE(Number(timezoneId), 0);

  await zk.executeCmd(COMMANDS.CMD_TZ_WRQ, payload);
}

async function ensureAccessTimezones(zk) {
  await writeAlwaysClosedTimezone(zk, ACCESS_TZ_BLOCKED);
}

async function allowUserAccess(zk, uid) {
  await writeUserTimezone(zk, uid, ACCESS_TZ_ALLOWED, 0, 0);
}

async function restrictUserAccess(zk, uid) {
  await writeUserTimezone(zk, uid, ACCESS_TZ_BLOCKED, 0, 0);
}

module.exports = {
  allowUserAccess,
  ensureAccessTimezones,
  restrictUserAccess,
  refreshDevice,
};
