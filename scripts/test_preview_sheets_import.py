import importlib.util
from pathlib import Path
import unittest
from decimal import Decimal

spec = importlib.util.spec_from_file_location('preview', Path(__file__).with_name('preview-sheets-import.py'))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class ImportPreviewTests(unittest.TestCase):
    def test_excel_date_epoch_and_fraction(self):
        self.assertEqual(preview.parse_date('45996').isoformat(), '2025-12-05T00:00:00')
        self.assertEqual(preview.parse_date('1.5', True).isoformat(), '1904-01-02T12:00:00')

    def test_day_first_text_and_invalid_calendar_date(self):
        self.assertEqual(preview.parse_date('05/12/2025').date().isoformat(), '2025-12-05')
        with self.assertRaises(ValueError):
            preview.parse_date('31/02/2026')

    def test_money_does_not_turn_missing_into_zero(self):
        self.assertIsNone(preview.money(''))
        self.assertEqual(preview.money('0'), Decimal('0'))
        self.assertEqual(preview.money('1,234.50'), Decimal('1234.50'))
        for value in ('-1', 'NaN', 'Infinity', '1.001'):
            with self.assertRaises(ValueError):
                preview.money(value)

    def test_audit_keeps_duplicate_periods_and_flags_device_collision(self):
        headers = ['Admission ID', 'Name', 'Mobile', 'Start Date', 'End Date',
                   'Total Amount', 'Discount', 'Final Amount', 'Amount Paid', 'Pending Amount', 'Timestamp']
        def row(number, values):
            return {'row': number, 'cells': {f'{chr(65+i)}{number}': {'value': value, 'type': 'str', 'formula': None}
                    for i, value in enumerate(values)}}
        values = ['ZF001', 'Sample', '9000000000', '2026-10-01', '2026-10-31', '100', '0', '100', '50', '50', '2026-10-01']
        sheets = {name: [row(1, headers)] for name in list(preview.MAIN) + list(preview.RENEW)}
        sheets['1 Month'] += [row(2, values), row(3, values), row(4, ['ALT001'] + values[1:])]
        records, issues, members, shared = preview.audit(sheets, False)
        self.assertEqual(len(records), 3)
        self.assertEqual(len(members), 2)
        self.assertEqual(shared, 1)
        self.assertTrue(any('Multiple admission IDs map' in i['reason'] for i in issues))
        self.assertTrue(any('Possible repeated membership period' in i['reason'] for i in issues))
        self.assertFalse(any('match final amount' in i['reason'] for i in issues))


if __name__ == '__main__':
    unittest.main()
