"""E1: reproducible peak-period VD observations, not a causal or policy model.

Download once with --download; rebuild from the ignored cache without network by
omitting it. Source hashes and gaps accompany the small published result.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo('Asia/Taipei')
BASE = 'https://tisvcloud.freeway.gov.tw/history/motc20/VD/'
PERIODS = [('2026-10-14', 'am'), ('2026-10-14', 'pm'),
           ('2026-10-15', 'am'), ('2026-10-15', 'pm'), ('2026-10-16', 'am')]
CITY_ROADS = ('堤頂', '環東', '成功', '民權', '成美', '麥帥', '陽光', '新明', '港墘', '瑞光')
GROUPS = {'south': '國道 1 號南向主線', 'north': '國道 1 號北向主線',
          'ramps': '東湖／內湖匝道', 'city': '內湖市區觀測點'}


def text(node, name):
    return node.findtext('{*}' + name, '')


def number(value, maximum=None):
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 and (maximum is None or n <= maximum) else None
    except (TypeError, ValueError):
        return None


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')


def slots(day, period):
    start = datetime.fromisoformat(day + ('T07:00:00+08:00' if period == 'am' else 'T17:00:00+08:00'))
    return [start + timedelta(minutes=5 * i) for i in range(31)]


def metadata(raw):
    root = ET.fromstring(gzip.decompress(raw))
    result = {}
    for vd in root.findall('.//{*}VD'):
        ident = text(vd, 'VDID')
        match = re.match(r'^VD-N1-([NS])-(\d+(?:\.\d+)?)-(M|I|O)-', ident)
        if not match or not 12 <= float(match[2]) <= 22:
            continue
        direction, km, kind = match[1], float(match[2]), match[3]
        lon, lat = number(text(vd, 'PositionLon')), number(text(vd, 'PositionLat'))
        if lon is None or lat is None or not (121.5 <= lon <= 121.7 and 25.03 <= lat <= 25.13):
            continue
        group = ('south' if direction == 'S' else 'north') if kind == 'M' else 'ramps'
        mile = text(vd, 'LocationMile')
        mile_match = re.fullmatch(r'(\d+)K\+(\d+)', mile)
        if mile_match:
            km = int(mile_match[1]) + int(mile_match[2]) / 1000
        suffix = '南向' if direction == 'S' else '北向'
        ramp_name = re.sub(r'^[A-Z]+-\d+[A-Z]?-', '', ident.split('-', 5)[-1])
        name = f'{mile} {suffix}' if kind == 'M' else ramp_name + ' ' + suffix + ('入口' if kind == 'I' else '出口')
        for link in vd.findall('.//{*}DetectionLink'):
            key = ident + ':' + text(link, 'LinkID')
            result[key] = dict(id=key, vd_id=ident, link_id=text(link, 'LinkID'),
                               name=name, group=group, direction=direction, km=km,
                               mile=mile, lat=lat, lon=lon, provider='NFB',
                               section_start=vd.findtext('.//{*}RoadSection/{*}Start', ''),
                               section_end=vd.findtext('.//{*}RoadSection/{*}End', ''),
                               metadata_time=text(root, 'UpdateTime'))
    return result


def observation(vd, link, expected):
    stamp = text(vd, 'DataCollectTime')
    try:
        age = abs((datetime.fromisoformat(stamp) - expected).total_seconds())
    except (ValueError, TypeError):
        return dict(speed=None, occupancy=None, time=stamp, reason='invalid_time')
    if age > 90 or text(vd, 'Status') != '0':
        return dict(speed=None, occupancy=None, time=stamp, reason='stale' if age > 90 else 'invalid_status')
    speeds, occupancies = [], []
    for lane in link.findall('.//{*}Lane'):
        occ = number(text(lane, 'Occupancy'), 100)
        counts = [number(text(v, 'Volume')) for v in lane.findall('.//{*}Vehicle')]
        volume = sum(counts) if counts and all(n is not None for n in counts) else None
        speed = number(text(lane, 'Speed'), 200)
        active = (volume is not None and volume > 0) or (occ is not None and occ > 0)
        if active and speed is not None:
            speeds.append(speed)
        if occ is not None:
            occupancies.append(occ)
    return dict(speed=round(statistics.mean(speeds), 1) if speeds else None,
                occupancy=round(statistics.mean(occupancies), 1) if occupancies else None,
                time=stamp, reason=None if speeds else 'no_active_valid_lane')


def parse_live(raw, sensors, expected):
    root = ET.fromstring(gzip.decompress(raw))
    rows = {}
    wanted = {s['vd_id'] for s in sensors.values()}
    for vd in root.findall('.//{*}VDLive'):
        ident = text(vd, 'VDID')
        if ident not in wanted:
            continue
        for link in vd.findall('.//{*}LinkFlow'):
            key = ident + ':' + text(link, 'LinkID')
            if key in sensors:
                rows[key] = observation(vd, link, expected)
    return rows


def summarize(values, step, threshold):
    """Missing or low-occupancy snapshots break a run; never infer its duration."""
    valid = [v for v in values if v and v['speed'] is not None]
    low = [v for v in valid if v['speed'] < threshold]
    dense = lambda v: bool(v and v['speed'] is not None and v['speed'] < threshold
                           and v['occupancy'] is not None and v['occupancy'] >= 25)
    runs, current = [], []
    previous = None
    for i, v in enumerate(values):
        is_dense = dense(v)
        stamp = datetime.fromisoformat(v['time']) if is_dense else None
        if current and (not is_dense or stamp <= previous or (stamp - previous).total_seconds() > step * 60 + 90):
            runs.append(current)
            current = []
        if is_dense:
            current.append(i)
        previous = stamp
    if current:
        runs.append(current)
    runs = [r for r in runs if len(r) >= 2]
    first = runs[0] if runs else None
    best = max(runs, key=len) if runs else []
    return dict(valid=len(valid), expected=len(values), low=len(low), dense=sum(dense(v) for v in values),
                low_pct=round(100 * len(low) / len(valid), 1) if valid else None,
                min_speed=min(v['speed'] for v in valid) if valid else None,
                first_run_time=values[first[0]]['time'] if first else None,
                first_run_left_censored=bool(first and first[0] == 0),
                longest_run_samples=len(best),
                longest_run_span_minutes=round((datetime.fromisoformat(values[best[-1]]['time']) - datetime.fromisoformat(values[best[0]]['time'])).total_seconds() / 60, 1) if best else 0,
                eligible=len(valid) >= math.ceil(.8 * len(values)), speed_threshold=threshold)


def fetch_file(cache, relative, download):
    path = cache / relative
    meta_path = path.with_suffix(path.suffix + '.json')
    url = BASE + relative
    if path.exists() and meta_path.exists():
        raw = path.read_bytes()
        record = json.loads(meta_path.read_text())
        if hashlib.sha256(raw).hexdigest() != record['sha256']:
            raise ValueError('Cache hash mismatch: ' + relative)
        return raw, record
    if not download:
        return None, dict(url=url, error='not_cached')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'tpethon-corridor-research/1.0'}), timeout=30) as response:
            raw = response.read(3_000_001)
        if len(raw) > 3_000_000:
            raise ValueError('Source exceeds size limit')
        ET.fromstring(gzip.decompress(raw))
        record = dict(url=url, fetched_at=datetime.now(TZ).isoformat(), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        write(meta_path, record)
        return raw, record
    except Exception as exc:
        return None, dict(url=url, error=str(exc)[:200], fetched_at=datetime.now(TZ).isoformat())


def build(cache, output, download=False):
    data = dict(schema_version=1, experiment='E1', generated_at=datetime.now(TZ).isoformat(),
                groups=GROUPS, periods=[], sources=[], methods=dict(highway_step_minutes=5, city_step_minutes=15,
                highway_speed_threshold=40, other_speed_threshold=20, occupancy_threshold=25, minimum_coverage=.8,
                note='相鄰低速且高占有率快照為待查線索，不是連續排隊時長或政策效果。國道／市區門檻不同，不比較比例高低。'))
    meta_by_day = {}
    for day in sorted({p[0] for p in PERIODS}):
        raw, record = fetch_file(cache, day.replace('-', '') + '/VD_0000.xml.gz', download)
        data['sources'].append(record)
        if raw is None:
            raise RuntimeError('Cannot select sensors without dated metadata: ' + str(record))
        meta_by_day[day] = metadata(raw)
    jobs = []
    for day, period in PERIODS:
        for stamp in slots(day, period):
            # NFB publication is one minute after DataCollectTime. Still validate each observation.
            relative = day.replace('-', '') + '/VDLive_' + (stamp + timedelta(minutes=1)).strftime('%H%M') + '.xml.gz'
            jobs.append((day, period, stamp, relative))
    fetched = {}
    def run(job):
        day, period, stamp, relative = job
        raw, record = fetch_file(cache, relative, download)
        return job, parse_live(raw, meta_by_day[day], stamp) if raw else {}, record
    with ThreadPoolExecutor(max_workers=3) as pool:
        for count, (job, rows, record) in enumerate(pool.map(run, jobs), 1):
            fetched[(job[0], job[1], job[2].isoformat())] = rows
            data['sources'].append(record)
            if count % 20 == 0:
                print(f'Processed {count}/{len(jobs)} source files', flush=True)
    for day, period in PERIODS:
        times = slots(day, period)
        sensors = meta_by_day[day]
        entry = dict(id=day + '-' + period, day=day, period=period,
                     label=day[5:] + (' 上班' if period == 'am' else ' 下班'),
                     times=[s.isoformat() for s in times], rows=[])
        for ident, sensor in sensors.items():
            values = [fetched[(day, period, stamp.isoformat())].get(ident) for stamp in times]
            threshold = 40 if sensor['group'] in ('north', 'south') else 20
            entry['rows'].append(dict(sensor=sensor, values=values, step_minutes=5,
                                       summary=summarize(values, 5, threshold)))
        city_path = ROOT / 'data' / 'history' / (day + '.json')
        entry['city_available'] = city_path.exists()
        if city_path.exists():
            city = json.loads(city_path.read_text())
            frames = {stamp: {v[0]: v for v in rows} for stamp, rows in city['frames']}
            expected_times = [s for s in times if s.minute % 15 == 0]
            for index, sensor in enumerate(city['sensors']):
                if not any(name in sensor['name'] for name in CITY_ROADS):
                    continue
                values = []
                for stamp in times:
                    value = frames.get(stamp.isoformat(), {}).get(index)
                    if value is None:
                        values.append(None)
                    else:
                        _, speed, occ, _, active, status = value
                        valid = status == '0' and active > 0 and number(speed, 200) is not None
                        values.append(dict(speed=speed if valid else None, occupancy=number(occ, 100),
                                           time=stamp.isoformat(), reason=None if valid else 'invalid_or_inactive'))
                expected_values = [values[times.index(s)] for s in expected_times]
                entry['rows'].append(dict(sensor={**sensor, 'provider': 'Taipei', 'group': 'city'},
                                         values=values, step_minutes=15, summary=summarize(expected_values, 15, 20)))
            data['sources'].append(dict(file=str(city_path.relative_to(ROOT)), sha256=hashlib.sha256(city_path.read_bytes()).hexdigest(),
                                        bytes=city_path.stat().st_size, upstream=city['sources']))
        entry['rows'].sort(key=lambda r: (list(GROUPS).index(r['sensor']['group']),
                              (-1 if r['sensor'].get('direction') == 'N' else 1) * r['sensor'].get('km', 0), r['sensor']['id']))
        data['periods'].append(entry)
    # Recurrence is only across comparable morning/morning or evening/evening periods.
    recurrent = []
    for period in ('am', 'pm'):
        days = [p for p in data['periods'] if p['period'] == period]
        identifiers = {r['sensor']['id'] for p in days for r in p['rows']}
        for ident in sorted(identifiers):
            rows = [(p['day'], r) for p in days for r in p['rows'] if r['sensor']['id'] == ident]
            eligible = [(day, r) for day, r in rows if r['summary']['eligible']]
            hits = [(day, r) for day, r in eligible if r['summary']['longest_run_samples'] >= 2]
            if len(hits) >= 2:
                recurrent.append(dict(sensor=rows[0][1]['sensor'], period=period, observed_days=len(eligible),
                                      hit_days=len(hits), days=[dict(day=day, **r['summary']) for day, r in hits]))
    data['recurrent'] = sorted(recurrent, key=lambda x: (-x['hit_days'], x['sensor']['id'], x['period']))
    # Sensitivity changes screening thresholds, not data, demand or road capacity.
    data['sensitivity'] = []
    for main_threshold, other_threshold in [(30, 15), (40, 20), (50, 25)]:
        hits = {}
        for entry in data['periods']:
            for row in entry['rows']:
                group = row['sensor']['group']
                threshold = main_threshold if group in ('south', 'north') else other_threshold
                values = row['values'][::3] if group == 'city' else row['values']
                summary = summarize(values, row['step_minutes'], threshold)
                key = (row['sensor']['id'], entry['period'], group)
                if summary['eligible'] and summary['longest_run_samples'] >= 2:
                    hits.setdefault(key, []).append(entry['day'])
        repeated = [dict(sensor_id=k[0], period=k[1], group=k[2], days=v) for k, v in sorted(hits.items()) if len(v) >= 2]
        data['sensitivity'].append(dict(main_threshold=main_threshold, other_threshold=other_threshold,
                                        recurrent=repeated, count=len(repeated)))
    write(output, data)
    print(json.dumps(dict(output=str(output), bytes=output.stat().st_size, periods=len(data['periods']),
                         files=len(jobs), failures=sum('error' in s for s in data['sources']),
                         recurrent=len(data['recurrent'])), ensure_ascii=False), flush=True)
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--cache', type=Path, default=ROOT / 'local-data' / 'corridor')
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'simulation' / 'corridor-experiment.json')
    args = parser.parse_args()
    build(args.cache, args.output, args.download)
