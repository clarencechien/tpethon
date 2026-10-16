import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts.refresh_weeks import completed_days, publish_weeks, calendar_reference
from tests.test_weeks import day


class RefreshWeeksTests(unittest.TestCase):
    def test_monday_and_year_rollover(self):
        self.assertEqual(completed_days(date(2027, 1, 4)), [date(2026, 12, n) for n in range(28, 32)] + [date(2027, 1, n) for n in range(1, 4)])
        self.assertEqual(len(completed_days(date(2026, 10, 18))), 13)

    def test_missing_day_preserves_previous_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archives = root / 'input'; archives.mkdir()
            output = root / 'weeks'; output.mkdir()
            (output / 'index.json').write_text('previous publication')
            with self.assertRaises(FileNotFoundError):
                publish_weeks(date(2026, 10, 19), archives, output, None)
            self.assertEqual((output / 'index.json').read_text(), 'previous publication')

    def test_rollover_prunes_old_summaries_and_keeps_empty_current_week(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archives = root / 'input'; archives.mkdir()
            output = root / 'weeks'; output.mkdir()
            (output / '2026-10-05.json').write_text('{}')
            (output / 'README.md').write_text('keep')
            (archives / '2026-10-05.json').write_text('{}')
            for d in completed_days(date(2026, 10, 19)):
                payload = day(str(d), [10, 40]); payload['sources'] = {'test': {}}
                (archives / f'{d}.json').write_text(json.dumps(payload))
            result = publish_weeks(date(2026, 10, 19), archives, output, None)
            self.assertEqual([w['available_days'] for w in result['weeks']], [7, 0])
            self.assertEqual(result['latest_available_day'], '2026-10-18')
            self.assertTrue(result['generated_at'].endswith('+08:00'))
            self.assertFalse((output / '2026-10-05.json').exists())
            self.assertFalse((archives / '2026-10-05.json').exists())
            self.assertTrue((output / 'README.md').exists())

    def test_calendar_requests_both_years(self):
        rows = [{'date': d.strftime('%Y%m%d'), 'isHoliday': False} for d in completed_days(date(2027, 1, 4))]
        with tempfile.TemporaryDirectory() as directory, patch('scripts.refresh_weeks.urllib.request.urlopen') as request:
            request.return_value.__enter__.return_value.read.return_value = json.dumps(rows).encode()
            target = Path(directory) / 'calendar.json'
            calendar_reference(date(2027, 1, 4), target)
            self.assertEqual([call.args[0].rsplit('/', 1)[-1] for call in request.call_args_list], ['2026.json', '2027.json'])
            self.assertEqual(len(json.loads(target.read_text())['sources']), 2)

class ReplayPublicationTests(unittest.TestCase):
    def test_rolling_replay_has_verified_files_and_prunes_only_old_days(self):
        from scripts.refresh_weeks import publish_replay
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);raw=root/'raw';raw.mkdir();output=root/'history';output.mkdir()
            (output/'2026-09-01.json').write_text('{}');(output/'README.md').write_text('keep')
            for d in completed_days(date(2026,10,16)):
                payload=day(str(d),[10,40]);payload.update(schema_version=1,sampling='exact_quarter_hour_snapshot',sources={'test':{}})
                (raw/f'{d}.json').write_text(json.dumps(payload))
            manifest=publish_replay(date(2026,10,16),raw,output)
            self.assertEqual(len(manifest['days']),11)
            self.assertEqual(manifest['latest_available_day'],'2026-10-15')
            self.assertFalse((output/'2026-09-01.json').exists());self.assertTrue((output/'README.md').exists())
            for entry in manifest['days']:
                encoded=(output/entry['file']).read_bytes()
                self.assertEqual(entry['sha256'],hashlib.sha256(encoded).hexdigest())
            original=(output/'2026-10-15.json').read_bytes()
            fresh=json.loads((raw/'2026-10-15.json').read_bytes());fresh['sources']={'new_download':{'sha256':'different compression'}}
            (raw/'2026-10-15.json').write_text(json.dumps(fresh))
            publish_replay(date(2026,10,16),raw,output)
            self.assertEqual((output/'2026-10-15.json').read_bytes(),original)
            fresh['frames'][0][1][0][1]=99
            (raw/'2026-10-15.json').write_text(json.dumps(fresh))
            with self.assertRaisesRegex(ValueError,'observations differ'):
                publish_replay(date(2026,10,16),raw,output)
            self.assertEqual((output/'2026-10-15.json').read_bytes(),original)
            before=(output/'index.json').read_bytes();(raw/'2026-10-15.json').unlink()
            with self.assertRaises(FileNotFoundError):publish_replay(date(2026,10,16),raw,output)
            self.assertEqual((output/'index.json').read_bytes(),before)
