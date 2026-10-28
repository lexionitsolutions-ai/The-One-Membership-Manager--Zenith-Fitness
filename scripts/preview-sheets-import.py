"""Read-only XLSX migration audit using Python's standard library.

Preserves every populated cell (including formula text and cached values) in a
private JSON archive. Never contacts Supabase or changes the source workbook.
"""
import argparse
import collections
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
MAIN = {'1 Month': '30', '3 Months': '90', '6 Months': '180', '1 Year': '365'}
RENEW = {'Renewals 1M': '30', 'Renewals 3M': '90', 'Renewals 6M': '180', 'Renewals 1Y': '365'}


def read_workbook(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(t.text or '' for t in si.findall('.//m:t', NS))
                       for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        book = ET.fromstring(z.read('xl/workbook.xml'))
        props = book.find('m:workbookPr', NS)
        date1904 = props is not None and props.get('date1904') in ('1', 'true')
        sheets = {}
        for sheet in book.find('m:sheets', NS):
            target = rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for row in ET.fromstring(z.read(part)).findall('m:sheetData/m:row', NS):
                cells = {}
                for c in row.findall('m:c', NS):
                    v, formula = c.find('m:v', NS), c.find('m:f', NS)
                    value = v.text if v is not None and v.text is not None else ''
                    if c.get('t') == 's':
                        value = strings[int(value)] if value else ''
                    elif c.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in c.findall('.//m:t', NS))
                    if value != '' or formula is not None:
                        cells[c.get('r')] = {'value': value, 'type': c.get('t', 'n'),
                                             'style': c.get('s'), 'formula': formula.text if formula is not None else None}
                if cells:
                    rows.append({'row': int(row.get('r')), 'cells': cells})
            sheets[sheet.get('name')] = rows
        return sheets, date1904


def parse_date(value, date1904=False):
    value = str(value).strip()
    if not value:
        return None
    if re.fullmatch(r'\d+(?:\.\d+)?', value):
        serial = float(value)
        if not 1 <= serial <= 150000:
            raise ValueError('Invalid Excel date serial')
        return (dt.datetime(1904, 1, 1) if date1904 else dt.datetime(1899, 12, 30)) + dt.timedelta(days=serial)
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        for fmt in ('%d-%m-%Y', '%d/%m/%Y', '%d-%m-%Y %H:%M:%S', '%d/%m/%Y %H:%M:%S'):
            try:
                return dt.datetime.strptime(value, fmt)
            except ValueError:
                pass
    raise ValueError('Unrecognized date; requires review')


def money(value):
    value = str(value).strip().replace(',', '').replace('\u20b9', '').strip()
    if not value:
        return None
    result = Decimal(value)
    if not result.is_finite() or result < 0 or result != result.quantize(Decimal('0.01')):
        raise ValueError('Invalid money amount')
    return result


def audit(sheets, date1904):
    issues, records = [], []
    def issue(level, sheet, row, field, reason, member=''):
        issues.append(dict(severity=level, sheet=sheet, row=row, admission_id=member, field=field, reason=reason))

    for name in list(MAIN) + list(RENEW):
        if name not in sheets or not sheets[name]:
            issue('blocker', name, 1, 'sheet', 'Required source tab missing or empty')
            continue
        rows = sheets[name]
        headers = {re.sub(r'\d+', '', ref): c['value'].strip() for ref, c in rows[0]['cells'].items()}
        required = {'Name', 'Mobile', 'Start Date', 'End Date', 'Final Amount'}
        for header in sorted(required - set(headers.values())):
            issue('blocker', name, rows[0]['row'], header, 'Required column missing')
        for row in rows[1:]:
            data = {headers.get(re.sub(r'\d+', '', ref), ref): c['value'] for ref, c in row['cells'].items()}
            member = str(data.get('Admission ID', data.get('ID', ''))).strip()
            if not member and not data.get('Name'):
                issue('review', name, row['row'], 'row', 'Non-member row preserved; not treated as a membership')
                continue
            rec = dict(sheet=name, row=row['row'], admission_id=member, data=data,
                       kind='admission' if name in MAIN else 'renewal', dates={}, amounts={})
            for field, value in [('Admission ID', member), ('Name', data.get('Name', '')), ('Mobile', data.get('Mobile', ''))]:
                if not str(value).strip():
                    issue('blocker', name, row['row'], field, 'Required value missing', member)
            digits = re.sub(r'\D', '', member)
            rec['device_user_id'] = int(digits) if digits else None
            if not rec['device_user_id'] or not 1 <= rec['device_user_id'] <= 65535:
                issue('blocker', name, row['row'], 'Admission ID', 'Cannot map to the current fingerprint user ID range', member)
            for field in ('Start Date', 'End Date', 'Timestamp'):
                try:
                    d = parse_date(data.get(field, ''), date1904)
                    rec['dates'][field] = d.isoformat() if d else None
                    if not d:
                        issue('blocker' if field != 'Timestamp' else 'review', name, row['row'], field, 'Date missing', member)
                except ValueError:
                    issue('blocker', name, row['row'], field, 'Unrecognized date', member)
            start, end = rec['dates'].get('Start Date'), rec['dates'].get('End Date')
            if start and end and start[:10] > end[:10]:
                issue('blocker', name, row['row'], 'End Date', 'End date precedes start date', member)
            for field in ('Total Amount' if name in MAIN else 'Amount', 'Discount', 'Final Amount', 'Amount Paid', 'Pending Amount'):
                try:
                    rec['amounts'][field] = money(data.get(field, ''))
                    if rec['amounts'][field] is None:
                        issue('review', name, row['row'], field, 'Missing money value; do not assume zero or paid in full', member)
                except (InvalidOperation, ValueError):
                    issue('blocker', name, row['row'], field, 'Invalid money amount', member)
            a = rec['amounts']
            gross, discount, final = a.get('Total Amount' if name in MAIN else 'Amount'), a.get('Discount'), a.get('Final Amount')
            if all(v is not None for v in (gross, discount, final)) and gross - discount != final:
                issue('blocker', name, row['row'], 'Final Amount', 'Total minus discount does not match final amount', member)
            paid, pending = a.get('Amount Paid'), a.get('Pending Amount')
            if all(v is not None for v in (paid, pending, final)) and paid + pending != final:
                issue('blocker', name, row['row'], 'Amount Paid', 'Paid plus pending does not match final amount', member)
            for ref, cell in row['cells'].items():
                if cell['type'] == 'e' or (cell['formula'] is not None and cell['value'] == ''):
                    issue('blocker', name, row['row'], ref, 'Formula error or missing cached formula result', member)
            records.append(rec)

    by_id = collections.defaultdict(list)
    devices, phones = collections.defaultdict(set), collections.defaultdict(set)
    seen_periods = {}
    for r in records:
        mid = r['admission_id']
        if not mid:
            continue
        by_id[mid].append(r)
        devices[r['device_user_id']].add(mid)
        phone = re.sub(r'\D', '', r['data'].get('Mobile', ''))
        if phone:
            phones[phone].add(mid)
        key = (mid, r['dates'].get('Start Date'), r['dates'].get('End Date'), str(r['amounts'].get('Final Amount')))
        if key[1] and key[2] and key in seen_periods:
            previous = seen_periods[key]
            issue('review', r['sheet'], r['row'], 'membership', f'Possible repeated membership period; also in {previous[0]} row {previous[1]}', mid)
        seen_periods[key] = (r['sheet'], r['row'])
    for mid, group in by_id.items():
        admissions = [r for r in group if r['kind'] == 'admission']
        if not admissions:
            r = group[0]
            issue('blocker', r['sheet'], r['row'], 'Admission ID', 'Renewal has no matching admission record', mid)
        elif len(admissions) > 1:
            r = admissions[0]
            issue('review', r['sheet'], r['row'], 'Admission ID', f'{len(admissions)} admission rows share this ID', mid)
        if len({r['data'].get('Name', '').strip().casefold() for r in group}) > 1:
            r = group[0]
            issue('review', r['sheet'], r['row'], 'Name', 'Name varies across history; choose current member details', mid)
    for uid, ids in devices.items():
        if uid is not None and len(ids) > 1:
            issue('blocker', 'Cross-tab check', '', 'device_user_id', f'Multiple admission IDs map to device UID {uid}', ', '.join(sorted(ids)))
    duplicate_phones = sum(1 for ids in phones.values() if len(ids) > 1)
    return records, issues, by_id, duplicate_phones


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sheets, date1904 = read_workbook(args.workbook)
    records, issues, members, duplicate_phones = audit(sheets, date1904)
    args.output.mkdir(parents=True, exist_ok=False)
    summary = dict(source_file=args.workbook.name, sha256=hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
                   sheet_count=len(sheets), unique_admission_ids=len(members),
                   admission_rows=sum(r['kind'] == 'admission' for r in records),
                   renewal_rows=sum(r['kind'] == 'renewal' for r in records),
                   shared_phone_groups=duplicate_phones,
                   issue_counts=dict(collections.Counter(i['severity'] for i in issues)),
                   issues_by_reason=dict(collections.Counter(i['reason'] for i in issues)),
                   sheets=[dict(name=k, populated_rows=len(v), classification='membership source' if k in MAIN or k in RENEW else 'preserved; needs separate mapping') for k,v in sheets.items()],
                   missing_expected_tabs=[n for n in ('Attendance', 'Enquiries') if n not in sheets],
                   status='PREVIEW ONLY; no database writes; resolve issues before import')
    for name, data in [('workbook-archive.json', dict(date1904=date1904, sheets=sheets)),
                       ('membership-preview.json', records), ('summary.json', summary)]:
        (args.output / name).write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding='utf-8')
    with (args.output / 'issues.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['severity','sheet','row','admission_id','field','reason'])
        writer.writeheader()
        writer.writerows(issues)
    (args.output / 'README.txt').write_text(
        'Private migration preview: contains personal member information.\n'
        'No source data was changed and no database was contacted.\n'
        'workbook-archive.json preserves source values, formulas and cell references.\n'
        'membership-preview.json is an audit intermediate, not an import payload.\n'
        'Do not import derived reporting tabs as additional payments or memberships.\n'
        'Reconcile Daily_Cashbook, Member Updates Log and Pending Amounts before importing payments.\n'
        'Dates stored as text use day/month/year conventions; validate against the original Sheet.\n'
        'Shared phone numbers do not establish duplicate identity.\n'
        'No fingerprint templates are present in this spreadsheet.\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
