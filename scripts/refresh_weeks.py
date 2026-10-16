"""Refresh rolling Taipei weeks; publish only after every completed day succeeds."""
import argparse
import json
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.backfill_tdx import TZ
from scripts.summarize_weeks import build
from scripts.build_profiles import publish as publish_profiles


def completed_days(as_of):
    start = as_of - timedelta(days=as_of.weekday() + 7)
    return [start + timedelta(days=n) for n in range((as_of - start).days)]


def calendar_reference(as_of, destination):
    """Fetch each required year, including the previous year at January rollover."""
    days, sources = [], []
    for year in sorted({d.year for d in completed_days(as_of)}):
        url = f'https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/{year}.json'
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Calendar response too large')
        rows = json.loads(raw)
        if not isinstance(rows, list):
            raise ValueError('Unexpected calendar schema')
        days.extend(rows)
        sources.append(url)
    indexed = {r['date']: r for r in days}
    for day in completed_days(as_of):
        if not isinstance(indexed.get(day.strftime('%Y%m%d'), {}).get('isHoliday'), bool):
            raise ValueError('Reference calendar missing a completed day')
    destination.write_text(json.dumps({'sources': sources, 'days': days}, ensure_ascii=False))


def publish_weeks(as_of, archives, output, calendar):
    """A missing or invalid day must not replace the last successful publication."""
    required = completed_days(as_of)
    for day in required:
        payload = json.loads((archives / f'{day}.json').read_bytes())
        if payload.get('day') != str(day) or not payload.get('frames') or not payload.get('sources'):
            raise ValueError('Invalid or empty daily archive: ' + str(day))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        staging = Path(directory)
        manifest = build(as_of, archives, staging, calendar)
        manifest['demand_profiles'] = publish_profiles(archives, staging)
        manifest['generated_at'] = datetime.now(TZ).isoformat(timespec='seconds')
        (staging / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        output.mkdir(parents=True, exist_ok=True)
        keep = {entry['file'] for entry in manifest['weeks']}
        keep.add(manifest['demand_profiles']['file'])
        for filename in sorted(keep) + ['index.json']:
            (staging / filename).replace(output / filename)
        # Only remove dated summary files; leave README or other files intact.
        for path in output.glob('????-??-??.json'):
            if path.name not in keep:
                path.unlink()
    # The cache retains only the compact days needed for these two weeks.
    keep_days = {f'{day}.json' for day in required}
    for path in archives.glob('????-??-??.json'):
        if path.name not in keep_days:
            path.unlink()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of', type=date.fromisoformat, default=datetime.now(TZ).date())
    args = parser.parse_args()
    if args.as_of > datetime.now(TZ).date():
        raise ValueError('as-of cannot be in the future')
    subprocess.run([sys.executable, str(ROOT / 'scripts/backfill_weeks.py'), '--as-of', str(args.as_of)], check=True)
    local = ROOT / 'local-data'
    with tempfile.TemporaryDirectory(dir=local) as directory:
        calendar = Path(directory) / 'calendar.json'
        calendar_reference(args.as_of, calendar)
        result = publish_weeks(args.as_of, local / 'weekly-history', ROOT / 'data/weeks', calendar)
    print(json.dumps({k: result[k] for k in ('as_of', 'latest_available_day', 'generated_at')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
