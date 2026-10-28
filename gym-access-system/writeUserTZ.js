const ZKLib = require("zklib-js");
const { COMMANDS } = require("zklib-js/constants");

const zk = new ZKLib("192.168.31.202", 4370, 10000, 4000);

// ==========================
// CHANGE THIS ONLY
// ==========================
const uid = 14;          // Atharva Dugani (ZF-4)
const mode = "block";   // "block" or "restore"
// ==========================

async function readUserTZ(uid) {
  const payload = Buffer.alloc(4);
  payload.writeUInt8(uid, 0);
  payload.writeUInt8(0, 1);
  payload.writeUInt8(0, 2);
  payload.writeUInt8(0, 3);

  const result = await zk.executeCmd(COMMANDS.CMD_USERTZ_RRQ, payload);

  return {
    raw: result.toString("hex"),
    groupTzFlag: result.readUInt16LE(8),
    tz1: result.readUInt16LE(10),
    tz2: result.readUInt16LE(12),
    tz3: result.readUInt16LE(14),
  };
}

async function writeUserTZ(uid, groupFlag, tz1, tz2 = 0, tz3 = 0) {
  const payload = Buffer.alloc(20);

  payload.writeUInt32LE(uid, 0);
  payload.writeUInt32LE(groupFlag, 4);
  payload.writeUInt32LE(tz1, 8);
  payload.writeUInt32LE(tz2, 12);
  payload.writeUInt32LE(tz3, 16);

  console.log("Write payload hex:", payload.toString("hex"));

  const result = await zk.executeCmd(COMMANDS.CMD_USERTZ_WRQ, payload);
  await zk.executeCmd(COMMANDS.CMD_REFRESHDATA, "");

  return result.toString("hex");
}

async function run() {
  try {
    await zk.createSocket();
    console.log("Connected to MB160");

    const before = await readUserTZ(uid);
    console.log("Before:", before);

    if (mode === "block") {
      console.log("\nBlocking user...");
      const reply = await writeUserTZ(uid, 1, 0, 0, 0);
      console.log("Write Reply:", reply);
    } else if (mode === "restore") {
      console.log("\nRestoring user...");
      const reply = await writeUserTZ(uid, 1, 1, 0, 0);
      console.log("Write Reply:", reply);
    } else {
      console.log('Invalid mode. Use "block" or "restore".');
      await zk.disconnect();
      return;
    }

    const after = await readUserTZ(uid);
    console.log("After:", after);

    await zk.disconnect();
    console.log("Disconnected");
  } catch (err) {
    console.error("Error:", err);
    try {
      await zk.disconnect();
    } catch {}
  }
}

run();