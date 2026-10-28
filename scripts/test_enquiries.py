from pathlib import Path
import json
import unittest
ROOT=Path(__file__).resolve().parents[1]/'migration-data/enquiries'

class EnquiryImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads((ROOT/'prepared.json').read_text(encoding='utf-8'))
        cls.source=json.loads((ROOT/'source-complete.json').read_text(encoding='utf-8'))
    def test_every_named_source_row_is_preserved(self):
        expected=sum(len(r)>1 and bool(str(r[1] or '').strip()) for r in self.source['values'][1:])
        self.assertEqual(len(self.data['leads'])+len(self.data['held']),expected)
        self.assertEqual(len(self.data['leads']),627)
        self.assertEqual(len({x['source_key'] for x in self.data['leads']}),627)
    def test_statuses_dates_and_invalid_legacy_date(self):
        lead=next(x for x in self.data['leads'] if x['source_key'].endswith(':151'))
        self.assertTrue(lead['needs_review']);self.assertIsNone(lead['follow_up_date']);self.assertIn('5//2026',lead['notes'])
        for row in self.data['leads']:
            self.assertIn(row['status'],('new','contacted','converted','closed'))
            if row['lead_status']=='Admission Done':self.assertEqual(row['status'],'converted')
            if row['lead_status'] in ('Wrong Number','Not Interested'):self.assertEqual(row['status'],'closed')
    def test_pending_snapshot_totals_and_bounds(self):
        self.assertEqual(len(self.data['balances']),9)
        for b in self.data['balances']:
            self.assertGreater(b['pending_amount'],0);self.assertGreaterEqual(b['amount_paid'],0)
        self.assertEqual(sum(b['pending_amount'] for b in self.data['balances']),26900)

if __name__=='__main__':unittest.main()
