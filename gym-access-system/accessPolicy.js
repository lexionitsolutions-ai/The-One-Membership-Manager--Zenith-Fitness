function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + serial * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  }

  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLike) {
    const [, yyyy, mm, dd, hh = '00', min = '00', ss = '00'] = isoLike;
    const date = new Date(`${yyyy}-${mm}-${dd}T${String(hh).padStart(2, '0')}:${min}:${ss}`);
    return isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('-');
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('/');
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  }

  const mdY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mdY) {
    const [, mm, dd, yyyy, hh = '00', min = '00', ss = '00'] = mdY;
    const date = new Date(
      `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${min}:${ss}`
    );
    return isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function startOfDay(value) {
  const date = parseDate(value);
  if (!date) return null;

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(value) {
  const date = parseDate(value);
  if (!date) return null;

  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  end.setHours(23, 59, 59, 999);
  return end;
}

function isMembershipExpired(endDate, now = new Date()) {
  const expiry = endOfDay(endDate);
  if (!expiry) return false;

  return expiry < now;
}

function isMembershipActive(member, now = new Date()) {
  const expiry = endOfDay(member?.endDate);
  if (!expiry || expiry < now) return false;

  const start = startOfDay(member?.startDate);
  if (start && start > now) return false;

  return true;
}

function formatDate(date) {
  const validDate = parseDate(date);
  if (!validDate) return '';

  const yyyy = validDate.getFullYear();
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const dd = String(validDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  formatDate,
  isMembershipActive,
  isMembershipExpired,
  parseDate,
};
