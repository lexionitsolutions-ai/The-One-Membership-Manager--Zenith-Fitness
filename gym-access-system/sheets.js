const { google } = require('googleapis');
const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = '1P8mvHg8_oBXQXZuP69QeJdy-HgvCk8nxOEy2cMkuAfU';

const mainSheets = ['1 Month', '3 Months', '6 Months', '1 Year'];
const renewalSheets = ['Renewals 1M', 'Renewals 3M', 'Renewals 6M', 'Renewals 1Y'];
const attendanceSheet = process.env.ATTENDANCE_SHEET || 'Attendance';

function parseDate(dateValue) {
  if (dateValue === null || dateValue === undefined || dateValue === '') {
    return null;
  }

  if (dateValue instanceof Date) {
    return isNaN(dateValue.getTime()) ? null : dateValue;
  }

  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + dateValue * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  const raw = String(dateValue).trim();
  if (!raw) return null;

  // Excel serial stored as string
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + serial * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd hh:mm:ss
  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLike) {
    const [, yyyy, mm, dd, hh = '00', min = '00', ss = '00'] = isoLike;
    const d = new Date(`${yyyy}-${mm}-${dd}T${String(hh).padStart(2, '0')}:${min}:${ss}`);
    return isNaN(d.getTime()) ? null : d;
  }

  // dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('-');
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // mm/dd/yyyy or m/d/yyyy with optional time
  const mdY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mdY) {
    const [, mm, dd, yyyy, hh = '00', min = '00', ss = '00'] = mdY;
    const d = new Date(
      `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${min}:${ss}`
    );
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function extractNumericId(id) {
  if (!id) return null;
  const num = parseInt(String(id).replace(/\D/g, ''), 10);
  return Number.isNaN(num) ? null : num;
}

async function getSheetRows(sheetName, range) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${range}`,
  });

  return res.data.values || [];
}

async function appendAttendanceRows(rows) {
  if (!rows || rows.length === 0) return;

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${attendanceSheet}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows,
    },
  });
}

function upsertUser(usersMap, candidate) {
  if (!candidate || !candidate.uid || !candidate.endDate) return;

  const key = String(candidate.uid);
  const existing = usersMap[key];

  if (!existing || candidate.endDate > existing.endDate) {
    usersMap[key] = {
      ...candidate,
      sheetId: String(candidate.sheetId || '').trim(),
      name: String(candidate.name || '').trim()
    };
  }
}

async function getMembers() {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Legacy Sheets member reads are disabled. Supabase is the primary database.');
  const usersMap = {};

  // Main sheets
  for (const sheetName of mainSheets) {
    const rows = await getSheetRows(sheetName, 'A2:I');

    for (const row of rows) {
      const id = String(row[0] || '').trim();
const name = String(row[1] || '').trim();
      const mobile = row[2] || '';
      const startDateRaw = row[7];
      const endDateRaw = row[8];

      if (!id || !name || !endDateRaw) continue;

      const uid = extractNumericId(id);
      const startDate = parseDate(startDateRaw);
      const endDate = parseDate(endDateRaw);

      if (!uid || !endDate) continue;

      upsertUser(usersMap, {
        uid,
        userId: String(uid),
        sheetId: id,
        name,
        phone: mobile,
        startDate,
        endDate,
        sourceSheet: sheetName,
      });
    }
  }

  // Renewal sheets
  for (const sheetName of renewalSheets) {
    const rows = await getSheetRows(sheetName, 'A2:F');

    for (const row of rows) {
      const id = String(row[0] || '').trim();
const name = String(row[1] || '').trim();
      const mobile = row[2] || '';
      const startDateRaw = row[4];
      const endDateRaw = row[5];

      if (!id || !name || !endDateRaw) continue;

      const uid = extractNumericId(id);
      const startDate = parseDate(startDateRaw);
      const endDate = parseDate(endDateRaw);

      if (!uid || !endDate) continue;

      upsertUser(usersMap, {
        uid,
        userId: String(uid),
        sheetId: id,
        name,
        phone: mobile,
        startDate,
        endDate,
        sourceSheet: sheetName,
      });
    }
  }

  return Object.values(usersMap);
}

module.exports = {
  getMembers,
  appendAttendanceRows,
};
