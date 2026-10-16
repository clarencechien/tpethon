"""Publish single-detector sampled Volume shapes; never infer interval totals or OD."""
import argparse
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.backfill_tdx import TZ

PERIODS = {'am': 420, 'pm': 1020}


def profiles(archives, weeks):
    index = json.loads((weeks / 'index.json').read_text())
    eligible = set()
    for entry in index['weeks']:
        week = json.loads((weeks / entry['file']).read_text())
        eligible.update(d['day'] for d in week['days'] if d['status'] == 'available'
                        and d['weekday'] <= 5 and d['reference_holiday'] is False)
    buckets = defaultdict(list); metadata = {}; changed = set(); sources = []
    for day in sorted(eligible):
        raw = (archives / f'{day}.json').read_bytes(); data = json.loads(raw)
        if data['day'] != day:
            raise ValueError('Profile archive date mismatch')
        sources.append({'day': day, 'sha256': hashlib.sha256(raw).hexdigest()})
        samples = {}
        for stamp, rows in data['frames']:
            dt = datetime.fromisoformat(stamp).astimezone(TZ)
            if dt.date().isoformat() != day or dt.second or dt.minute % 15:
                continue
            minute = dt.hour * 60 + dt.minute
            for values in rows:
                sensor = data['sensors'][values[0]]
                record = dict(zip(data['columns'][1:], values[1:]))
                volume = record.get('volume')
                # A healthy zero-flow lane is a real zero, not a missing sample.
                if record.get('status') != '0' or not isinstance(volume, (int, float)) or not math.isfinite(volume) or volume < 0:
                    continue
                ident = sensor['id']; signature = {k: sensor.get(k) for k in ('id', 'vd_id', 'link_id', 'name', 'direction', 'lat', 'lon', 'lanes')}
                if ident in metadata and metadata[ident] != signature:
                    changed.add(ident)
                metadata[ident] = signature
                key = (ident, minute)
                if key in samples and samples[key] != volume:
                    raise ValueError('Conflicting profile sample')
                samples[key] = volume
        for ident in {key[0] for key in samples}:
            for period, begin in PERIODS.items():
                values = [samples.get((ident, m)) for m in range(begin, begin + 150, 15)]
                # Same full-day cohort for every slot; never fill missing slots.
                if all(value is not None for value in values):
                    buckets[(ident, period)].append({'day': day, 'values': values})
    result = []
    for (ident, period), days in sorted(buckets.items()):
        if ident in changed or len(days) < 3:
            continue
        means = [statistics.mean(d['values'][i] for d in days) for i in range(10)]
        if sum(means) <= 0:
            continue
        result.append({**metadata[ident], 'sensor_id': ident, 'id': f'{ident}:{period}', 'period': period,
                       'start_minute': PERIODS[period], 'step_minutes': 15, 'duration_minutes': 150,
                       'days': [d['day'] for d in days], 'values': means, 'daily_values': days})
    return {'schema_version': 1, 'as_of': index['as_of'], 'latest_source_day': max(eligible, default=None),
            'timezone': 'Asia/Taipei', 'kind': 'single_direction_sampled_volume_shape',
            'volume_unit': 'source_reported_volume_per_unverified_interval', 'interval_minutes': None,
            'peak_total_vehicles': None, 'people': None, 'capacity': None,
            'method': 'Equal mean over complete 10-slot weekdays per detector-direction; >=3 dates; reference holidays excluded. No sum across sensors or across sample intervals.',
            'calendar_verified_official': False, 'source_files': sources, 'profiles': result,
            'excluded_changed_metadata_sensors': len(changed)}


def publish(archives, weeks):
    payload = profiles(archives, weeks)
    raw = (json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (weeks / 'profiles.json').write_bytes(raw)
    return {'file': 'profiles.json', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'count': len(payload['profiles'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'local-data/weekly-history')
    parser.add_argument('--weeks', type=Path, default=ROOT / 'data/weeks')
    args = parser.parse_args()
    descriptor = publish(args.input, args.weeks)
    path = args.weeks / 'index.json'; index = json.loads(path.read_text()); index['demand_profiles'] = descriptor
    path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(descriptor))
