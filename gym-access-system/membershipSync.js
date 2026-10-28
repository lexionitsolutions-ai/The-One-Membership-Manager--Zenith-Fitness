const { google } = require("googleapis");
const {
  createUserOnDevice,
  deleteUserFromDevice,
  recreateUserOnDevice,
} = require("./deviceService");

const SPREADSHEET_ID = "1P8mvHg8_oBXQXZuP69QeJdy-HgvCk8nxOEy2cMkuAfU";
const KEY_FILE = "./credentials.json";
const SHEET_NAMES = ["1 Month", "3 Months", "6 Months", "1 Year"];

const COL = {
  admissionId: 0,
  name: 1,
  mobile: 2,
  gender: 3,
  age: 4,
  plan: 5,
  category: 6,
  startDate: 7,
  endDate: 8,
  totalAmount: 9,
  discount: 10,
  finalAmount: 11,
  paymentMode: 12,
  paymentStatus: 13,
  remarks: 14,
  timestamp: 15,
  whatsappMessage: 16,
  birthDate: 17,
  address: 18,
  medicalHistory: 19,
  deviceStatus: 20,
  fingerprintStatus: 21,
};

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getSheetRows(sheetName) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy Sheets membership sync is retired.');
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A2:V`,
  });

  return res.data.values || [];
}

async function updateRow(sheetName, rowNumber, values) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy Sheets membership writes are retired.');
  const sheets = await getSheetsClient();

  while (values.length < 22) values.push("");

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A${rowNumber}:V${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values],
    },
  });
}

function getNumericId(admissionId) {
  return Number(String(admissionId).replace(/\D/g, ""));
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function todayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildMemberObject(row, sheetName, rowNumber) {
  const admissionId = row[COL.admissionId];
  const numericId = getNumericId(admissionId);

  return {
    sheetName,
    rowNumber,
    admissionId,
    name: row[COL.name],
    mobile: row[COL.mobile],
    startDate: row[COL.startDate],
    endDate: row[COL.endDate],
    uid: numericId,
    userId: String(numericId),
    deviceStatus: row[COL.deviceStatus] || "",
    fingerprintStatus: row[COL.fingerprintStatus] || "",
  };
}

async function handleNewAdmission(sheetName, rowNumber) {
  const rows = await getSheetRows(sheetName);
  const row = rows[rowNumber - 2];

  if (!row) {
    console.log(`Row ${rowNumber} not found in ${sheetName}`);
    return;
  }

  while (row.length < 22) row.push("");

  const member = buildMemberObject(row, sheetName, rowNumber);
  const result = await createUserOnDevice(member);

  row[COL.deviceStatus] = result.success
    ? result.accessAllowed ? "ACTIVE" : "BLOCKED_INACTIVE"
    : "DEVICE_CREATE_FAILED";
  row[COL.fingerprintStatus] = result.success ? "PENDING_ENROLLMENT" : "NOT_ENROLLED";

  await updateRow(sheetName, rowNumber, row);

  console.log(
    result.success
      ? `New admission synced: ${member.name} [${sheetName}]`
      : `New admission failed: ${member.name} [${sheetName}]`
  );
}

async function expireMembersOnDevice() {
  const today = todayAtMidnight();

  for (const sheetName of SHEET_NAMES) {
    const rows = await getSheetRows(sheetName);

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2;
      const row = rows[i];

      while (row.length < 22) row.push("");

      const member = buildMemberObject(row, sheetName, rowNumber);
      const endDate = parseDate(member.endDate);

      if (!endDate) continue;

      if (today > endDate && member.deviceStatus !== "EXPIRED_DELETED") {
        const deleteResult = await deleteUserFromDevice(member.uid);

        row[COL.deviceStatus] = deleteResult.success ? "EXPIRED_DELETED" : "DELETE_FAILED";
        row[COL.fingerprintStatus] = deleteResult.success
          ? "DELETED_FROM_DEVICE"
          : row[COL.fingerprintStatus];

        await updateRow(sheetName, rowNumber, row);

        console.log(
          deleteResult.success
            ? `${member.name} deleted from device [${sheetName}]`
            : `${member.name} delete failed [${sheetName}]`
        );
      }
    }
  }
}

async function handleRenewal(sheetName, rowNumber) {
  const rows = await getSheetRows(sheetName);
  const row = rows[rowNumber - 2];

  if (!row) {
    console.log(`Row ${rowNumber} not found in ${sheetName}`);
    return;
  }

  while (row.length < 22) row.push("");

  const member = buildMemberObject(row, sheetName, rowNumber);
  const result = await recreateUserOnDevice(member);

  row[COL.deviceStatus] = result.success
    ? result.accessAllowed ? "RENEWED_FP_PENDING" : "RENEWED_BLOCKED_INACTIVE"
    : "RENEW_CREATE_FAILED";
  row[COL.fingerprintStatus] = result.success
    ? "REENROLL_REQUIRED"
    : row[COL.fingerprintStatus];

  await updateRow(sheetName, rowNumber, row);

  console.log(
    result.success
      ? `Renewal synced: ${member.name} [${sheetName}]`
      : `Renewal failed: ${member.name} [${sheetName}]`
  );
}

async function markFingerprintEnrolled(sheetName, rowNumber) {
  const rows = await getSheetRows(sheetName);
  const row = rows[rowNumber - 2];

  if (!row) {
    console.log(`Row ${rowNumber} not found in ${sheetName}`);
    return;
  }

  while (row.length < 22) row.push("");

  row[COL.deviceStatus] = "ACTIVE";
  row[COL.fingerprintStatus] = "FP_ENROLLED";

  await updateRow(sheetName, rowNumber, row);
  console.log(`Fingerprint marked enrolled [${sheetName} row ${rowNumber}]`);
}

module.exports = {
  handleNewAdmission,
  expireMembersOnDevice,
  handleRenewal,
  markFingerprintEnrolled,
};
