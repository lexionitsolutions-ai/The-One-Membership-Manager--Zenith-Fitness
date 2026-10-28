const ZKLib = require("zklib-js");
const { COMMANDS } = require("zklib-js/constants");
const {
  allowUserAccess,
  ensureAccessTimezones,
  restrictUserAccess,
  refreshDevice,
} = require("./accessControl");
const { isMembershipActive } = require("./accessPolicy");

const DEVICE_IP = process.env.DEVICE_IP || "192.168.31.202";
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);
const DEVICE_TIMEOUT = Number(process.env.DEVICE_TIMEOUT || 10000);
const DEVICE_INPORT = Number(process.env.DEVICE_INPORT || 4000);

function createDevice() {
  return new ZKLib(DEVICE_IP, DEVICE_PORT, DEVICE_TIMEOUT, DEVICE_INPORT);
}

async function connectDevice(zk) {
  await zk.createSocket();
  console.log("Device connected");
}

async function disconnectDevice(zk) {
  try {
    await zk.disconnect();
    console.log("Device disconnected");
  } catch {}
}

async function getAllUsers(zk) {
  const users = await zk.getUsers();
  return users.data || [];
}

async function findUser(zk, uid, userId) {
  const users = await getAllUsers(zk);
  return users.find(
    (u) =>
      (uid !== undefined && Number(u.uid) === Number(uid)) ||
      (userId !== undefined && String(u.userId) === String(userId))
  );
}

async function createUserOnDevice(member) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy device creation is disabled. Use Supabase secondary sync.');
  const zk = createDevice();

  try {
    await connectDevice(zk);
    await ensureAccessTimezones(zk);

    const accessAllowed = isMembershipActive(member);

    const result = await zk.setUser(
      Number(member.uid),
      String(member.userId),
      String(member.name),
      "",
      0,
      0
    );

    const createdUser = await findUser(zk, member.uid, member.userId);

    if (accessAllowed) {
      await allowUserAccess(zk, member.uid);
    } else {
      await restrictUserAccess(zk, member.uid);
    }

    await refreshDevice(zk);

    return {
      success: true,
      accessAllowed,
      result,
      user: createdUser || null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  } finally {
    await disconnectDevice(zk);
  }
}

async function deleteUserFromConnectedDevice(zk, uid) {
  const payload = Buffer.alloc(72);
  payload.writeUInt16LE(Number(uid), 0);

  const reply = await zk.executeCmd(COMMANDS.CMD_DELETE_USER, payload);
  await zk.executeCmd(COMMANDS.CMD_REFRESHDATA, "");

  return reply;
}

async function deleteUserFromDevice(uid) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy device deletion is disabled.');
  const zk = createDevice();

  try {
    await connectDevice(zk);

    const reply = await deleteUserFromConnectedDevice(zk, uid);

    const check = await findUser(zk, uid);

    return {
      success: !check,
      replyHex: reply.toString("hex"),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  } finally {
    await disconnectDevice(zk);
  }
}

async function recreateUserOnDevice(member) {
  return await createUserOnDevice(member);
}

module.exports = {
  createUserOnDevice,
  deleteUserFromDevice,
  recreateUserOnDevice,
};
