import json
from decimal import Decimal
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class RealDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=json.loads((ROOT/'migration-data/real-data/snapshot.json').read_text(encoding='utf-8'))
    def test_members_preserve_unique_device_identity(self):
        members=self.data['members']
        self.assertEqual(len(members),652)
        self.assertEqual(len({m['id'] for m in members}),len(members))
        self.assertEqual(len({m['device_user_id'] for m in members}),len(members))
        self.assertTrue(all(1<=m['device_user_id']<=65535 for m in members))
        self.assertTrue(all(not m['phone'] or 'E' not in m['phone'] for m in members))
    def test_periods_and_quarantine_account_for_source_rows(self):
        self.assertEqual(len(self.data['memberships'])+len(self.data['reviewRecords']),1196)
        ids={m['id'] for m in self.data['members']}
        for m in self.data['memberships']:
            self.assertIn(m['member_id'],ids)
            self.assertLessEqual(m['start_date'],m['end_date'])
            self.assertGreaterEqual(m['historical_charge'],0)
            if m['total_amount'] is not None:
                self.assertAlmostEqual(m['total_amount']-m['discount_amount'],m['historical_charge'],places=2)
            if m['accounting_verified']:
                self.assertIsNotNone(m['opening_paid_amount'])
                self.assertLessEqual(m['opening_paid_amount'],m['historical_charge'])
            else:self.assertIsNone(m['opening_paid_amount'])
    def test_cashbook_is_not_duplicated_as_payment_history(self):
        self.assertEqual(self.data['payments'],[])
        receipts=self.data['historicalReceipts']
        self.assertEqual(len(receipts),673)
        self.assertEqual(len({r['source_key'] for r in receipts}),673)
        archive=json.loads((ROOT/'migration-data/preview-2026-10-27/workbook-archive.json').read_text(encoding='utf-8'))
        total=sum(Decimal(c['value']) for row in archive['sheets']['Daily_Cashbook'][1:] for ref,c in row['cells'].items() if ref.startswith('D'))
        self.assertEqual(sum(Decimal(str(r['amount'])) for r in receipts),total)

if __name__=='__main__':unittest.main()
