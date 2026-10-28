const ZKLib = require('zklib-js');

const DEVICE_IP = process.env.DEVICE_IP || '192.168.31.202';
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);
const DEVICE_TIMEOUT = Number(process.env.DEVICE_TIMEOUT || 10000);
const INPORT = Number(process.env.DEVICE_INPORT || 4000);
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === '1';

async function connectDevice() {
  try {
    const zk = new ZKLib(
      DEVICE_IP,
      DEVICE_PORT,
      DEVICE_TIMEOUT,
      INPORT
    );

    await zk.createSocket();

    if (VERBOSE_LOGS) {
      console.log(`Connected to device at ${DEVICE_IP}:${DEVICE_PORT}`);
    }

    return zk;
  } catch (err) {
    console.log(`Device connection failed: ${err.message || err}`);
    return null;
  }
}

module.exports = {
  connectDevice,
};
