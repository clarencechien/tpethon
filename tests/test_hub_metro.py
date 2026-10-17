import csv
import hashlib
import io
import json
import unittest
from pathlib import Path
from scripts.prepare_hub_metro import aggregate

ROOT = Path(__file__).resolve().parents[1]


class HubMetroTests(unittest.TestCase):
    def rows(self):
        return [f'{day},{hour},BL板橋,{target},{value}\n'
                for day, value in [('2026-09-01', 10), ('2026-09-02', 0), ('2026-09-05', 99)]
                for hour in (7, 8, 9) for target in ('西湖', '港墘')]

    def parse(self, rows):
        return aggregate(csv.DictReader(io.StringIO('日期,時段,進站,出站,人次\n' + ''.join(rows))), '2026-09')

    def test_zero_day_retained_and_weekend_excluded(self):
        result = self.parse(self.rows())
        self.assertEqual(result['dates'], ['2026-09-01', '2026-09-02'])
        self.assertEqual(result['total_journeys'], 60)
        self.assertEqual(result['origins'][0]['daily_hourly'], [[20, 20, 20], [0, 0, 0]])
        self.assertFalse(result['used_as_private_car_weights'])

    def test_duplicate_missing_and_negative_observations_rejected(self):
        for rows in [self.rows() + [self.rows()[0]], self.rows()[1:], [self.rows()[0].replace(',10\n', ',-1\n')] + self.rows()[1:]]:
            with self.subTest(rows=rows[:1]):
                with self.assertRaises(ValueError):
                    self.parse(rows)

    def test_published_all_origins_reconcile_daily_and_hourly_reference(self):
        data = json.loads((ROOT / 'data/simulation/hub-metro.json').read_text())
        raw = (ROOT / 'docs/research/metro_od_findings.json').read_bytes()
        ref = json.loads(raw)
        self.assertEqual(data['reference_sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(data['dates'], ref['dates'])
        self.assertEqual(data['total_journeys'], ref['total_journeys'])
        for i, day in enumerate(data['dates']):
            self.assertEqual(sum(sum(o['daily_hourly'][i]) for o in data['origins']), ref['daily_totals'][day])
        for k, h in enumerate(data['entry_hours']):
            total = sum(sum(d[k] for d in o['daily_hourly']) for o in data['origins'])
            self.assertEqual(round(total / len(data['dates']), 2), ref['hourly_means'][str(h)])
        self.assertIn('BL板橋', [o['station'] for o in data['origins']])


if __name__ == '__main__':
    unittest.main()
