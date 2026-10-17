"""Aggregate observed metro entry stations, without inferring residence or car demand."""
import csv
import hashlib
import json
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ('西湖', '港墘')


def aggregate(reader, month):
    if not {'日期', '時段', '進站', '出站', '人次'}.issubset(reader.fieldnames or []):
        raise ValueError('Unknown metro OD schema')
    days, seen, values = set(), set(), defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    targets = defaultdict(int)
    coverage = set()
    count = 0
    for row in reader:
        count += 1
        day = row['日期'].replace('/', '-')
        stamp = date.fromisoformat(day)
        if day[:7] != month:
            raise ValueError('Mixed month in source')
        hour = int(row['時段'])
        if stamp.weekday() >= 5 or hour not in (7, 8, 9):
            continue
        days.add(day)
        if row['出站'] not in TARGETS:
            continue
        origin, target = row['進站'].strip(), row['出站']
        value = int(row['人次'])
        key = (day, hour, origin, target)
        if not origin or value < 0 or key in seen:
            raise ValueError('Invalid or duplicate target OD observation')
        seen.add(key)
        coverage.add((day, hour, target))
        values[origin][day][hour - 7] += value
        targets[target] += value
    dates = sorted(days)
    if not dates or any((d, h, t) not in coverage for d in dates for h in (7, 8, 9) for t in TARGETS):
        raise ValueError('Missing target/day/hour coverage')
    origins = [dict(station=s, daily_hourly=[v.get(d, [0, 0, 0]) for d in dates]) for s, v in sorted(values.items())]
    total = sum(sum(hours) for o in origins for hours in o['daily_hourly'])
    if total <= 0:
        raise ValueError('No observed journeys')
    return dict(schema_version=1, month=month, dates=dates, entry_hours=[7, 8, 9],
                targets=list(TARGETS), input_rows=count, total_journeys=total,
                target_totals=dict(targets), origins=origins,
                note='週一至週五，未排除國定假日；07–10時進站、出站為西湖或港墘的人次。進站地不是居住地，進站時間不是到達時間；不代表新增BRT需求或可減少私車。',
                used_as_private_car_weights=False)


def main():
    reference_path = ROOT / 'docs/research/metro_od_findings.json'
    reference_raw = reference_path.read_bytes()
    reference = json.loads(reference_raw)
    url = reference['source']
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'tcgmetro.blob.core.windows.net':
        raise ValueError('Unexpected source host')
    checksum = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=60) as response:
        def lines():
            nonlocal size
            for line in response:
                size += len(line)
                checksum.update(line)
                yield line.decode('utf-8-sig')
        result = aggregate(csv.DictReader(lines()), reference['month'])
    totals = {d: sum(sum(o['daily_hourly'][i]) for o in result['origins']) for i, d in enumerate(result['dates'])}
    if result['total_journeys'] != reference['total_journeys'] or totals != reference['daily_totals'] or result['input_rows'] != reference['input_rows']:
        raise ValueError('Source disagrees with previous independent OD aggregation')
    result.update(source=dict(url=url, bytes=size, sha256=checksum.hexdigest(), fetched_at=datetime.now(timezone.utc).isoformat()),
                  reference_sha256=hashlib.sha256(reference_raw).hexdigest())
    output = ROOT / 'data/simulation/hub-metro.json'
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(dict(stations=len(result['origins']), dates=len(result['dates']), total=result['total_journeys'], source_bytes=size, published_bytes=output.stat().st_size)))


if __name__ == '__main__':
    main()
