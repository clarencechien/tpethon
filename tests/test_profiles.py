import json
import tempfile
import unittest
from pathlib import Path
from scripts.build_profiles import profiles


class ProfileTests(unittest.TestCase):
    def fixture(self, root):
        archives = root / 'input'; archives.mkdir(); weeks = root / 'weeks'; weeks.mkdir()
        days = []
        for n in range(12, 16):
            day = f'2026-10-{n}'; days.append({'day': day, 'weekday': n - 11, 'status': 'available', 'reference_holiday': False})
            data = {'day': day, 'sensors': [{'id': 'A:N', 'name': 'road', 'direction': 'N', 'lanes': 2}],
                    'columns': ['sensor', 'volume', 'status'],
                    'frames': [[f'{day}T{m//60:02}:{m%60:02}:00+08:00', [[0, i, '0']]] for i, m in enumerate(range(420, 570, 15))]}
            (archives / f'{day}.json').write_text(json.dumps(data))
        (weeks / 'index.json').write_text(json.dumps({'as_of': '2026-10-16', 'weeks': [{'file': 'week.json'}]}))
        (weeks / 'week.json').write_text(json.dumps({'days': days}))
        return archives, weeks

    def test_missing_slot_excludes_entire_day_without_zero_filling(self):
        with tempfile.TemporaryDirectory() as folder:
            a, w = self.fixture(Path(folder)); p = a / '2026-10-15.json'; d = json.loads(p.read_text()); d['frames'].pop(); p.write_text(json.dumps(d))
            data = profiles(a, w); profile = data['profiles'][0]
            self.assertEqual(len(profile['days']), 3); self.assertEqual(profile['values'], list(range(10)))
            self.assertIsNone(data['peak_total_vehicles']); self.assertIsNone(data['interval_minutes']); self.assertIsNone(data['people'])

    def test_reference_holiday_and_invalid_status_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            a, w = self.fixture(Path(folder)); p = w / 'week.json'; d = json.loads(p.read_text()); d['days'][0]['reference_holiday'] = True; p.write_text(json.dumps(d))
            p = a / '2026-10-15.json'; d = json.loads(p.read_text()); d['frames'][0][1][0][2] = '3'; p.write_text(json.dumps(d))
            self.assertEqual(profiles(a, w)['profiles'], [])  # Only two full eligible days.

    def test_changed_sensor_metadata_is_not_pooled(self):
        with tempfile.TemporaryDirectory() as folder:
            a, w = self.fixture(Path(folder)); p = a / '2026-10-15.json'; d = json.loads(p.read_text()); d['sensors'][0]['lanes'] = 3; p.write_text(json.dumps(d))
            data = profiles(a, w); self.assertEqual(data['profiles'], []); self.assertEqual(data['excluded_changed_metadata_sensors'], 1)

    def test_healthy_zero_is_retained_and_other_direction_is_not_added(self):
        with tempfile.TemporaryDirectory() as folder:
            a, w = self.fixture(Path(folder))
            for path in a.glob('*.json'):
                d = json.loads(path.read_text()); d['sensors'].append({'id': 'A:S', 'name': 'road', 'direction': 'S', 'lanes': 2})
                for frame in d['frames']: frame[1].append([1, 100, '0'])
                path.write_text(json.dumps(d))
            result = {p['sensor_id']: p for p in profiles(a, w)['profiles']}
            self.assertEqual(result['A:N']['values'][0], 0); self.assertEqual(result['A:S']['values'], [100] * 10)
