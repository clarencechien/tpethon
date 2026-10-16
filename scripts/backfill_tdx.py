"""Fetch one completed Taipei VD day and publish compact, source-timed samples.

Credentials stay in the environment. Full-city responses stay in ignored local-data.
The output contains actual observations every 15 minutes, NOT interval aggregates.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dashboard import parse_roads
from live import inside

TZ = ZoneInfo('Asia/Taipei')
HOST = 'https://tdx.transportdata.tw'
BASE = HOST + '/api/historical/v2/Historical/Road/Traffic/'
TOKEN_URL = HOST + '/auth/realms/TDXConnect/protocol/openid-connect/token'
METADATA_FIELDS = ('id', 'vd_id', 'link_id', 'name', 'lat', 'lon', 'direction', 'bearing', 'lanes')
VALUE_FIELDS = ('sensor', 'speed', 'occupancy', 'volume', 'active_lanes', 'status')
MAX_RAW = 2_000_000_000
MAX_DOWNLOAD = 250_000_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected redirect; credentials were not forwarded')

OPENER = urllib.request.build_opener(NoRedirect)

def token():
    ident = os.environ.get('tdxid') or os.environ.get('TDX_CLIENT_ID')
    secret = os.environ.get('tdxsec') or os.environ.get('TDX_CLIENT_SECRET')
    if not ident or not secret:
        raise ValueError('Missing tdxid/tdxsec (or TDX_CLIENT_ID/TDX_CLIENT_SECRET)')
    body = urllib.parse.urlencode(dict(grant_type='client_credentials', client_id=ident, client_secret=secret)).encode()
    with OPENER.open(urllib.request.Request(TOKEN_URL, data=body), timeout=30) as r:
        result = json.load(r)
    return result['access_token']

def endpoint(kind, day, **extra):
    query = {'Dates': day, '$format': 'JSONL', **extra}
    return BASE + kind + '/City/Taipei?' + urllib.parse.urlencode(query)

def open_data(request):
    for attempt in range(4):
        try:
            return OPENER.open(request, timeout=120)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt == 3: raise
            retry = exc.headers.get('Retry-After', '')
            delay = max(10 * (attempt + 1), int(retry) if retry.isdigit() else 0)
            if delay > 60: raise  # Do not retry earlier than the server permits.
            print(f'TDX HTTP {exc.code}; retry in {delay}s', flush=True)
            exc.close(); time.sleep(delay)

def download(url, bearer, path):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + bearer, 'Accept-Encoding': 'gzip'})
    digest = hashlib.sha256(); size = 0
    temporary = path.with_suffix('.part')
    try:
        with open_data(request) as r, temporary.open('wb') as f:
            while chunk := r.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_DOWNLOAD:
                    raise ValueError('Download exceeded 250 MB; original publication unchanged')
                digest.update(chunk); f.write(chunk)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return dict(url=url, downloaded_bytes=size, sha256=digest.hexdigest())

def records(path):
    with path.open('rb') as raw:
        signature = raw.read(2); raw.seek(0)
        source = gzip.GzipFile(fileobj=raw) if signature == b'\x1f\x8b' else raw
        total = 0
        with io.TextIOWrapper(source, encoding='utf-8-sig') as text:
            while line := text.readline(2_000_001):
                total += len(line.encode('utf-8'))
                if len(line) > 2_000_000 or total > MAX_RAW:
                    raise ValueError('Decoded data exceeds safety size limit')
                if line.strip():
                    item = json.loads(line)
                    if not isinstance(item, dict):
                        raise ValueError('Expected JSONL records')
                    yield item

def element(parent, tag, value):
    child = ET.SubElement(parent, tag)
    if value is not None: child.text = str(value)
    return child

def static_xml(items):
    root = ET.Element('VDList')
    for item in items:
        vd = ET.SubElement(root, 'VD')
        for key in ('VDID', 'RoadName', 'PositionLat', 'PositionLon'):
            element(vd, key, item.get(key))
        for link in item.get('DetectionLinks', []):
            child = ET.SubElement(vd, 'DetectionLink')
            for key in ('LinkID', 'RoadDirection', 'Bearing'): element(child, key, link.get(key))
    return ET.tostring(root)

def live_xml(items, stamp):
    root = ET.Element('VDLiveList'); element(root, 'UpdateTime', stamp)
    for item in items:
        vd = ET.SubElement(root, 'VDLive')
        for key in ('VDID', 'Status'): element(vd, key, item.get(key))
        element(vd, 'DataCollectTime', stamp)
        for link in item['LinkFlows']:
            child = ET.SubElement(vd, 'LinkFlow'); element(child, 'LinkID', link.get('LinkID'))
            for lane in link['Lanes']:
                lane_el = ET.SubElement(child, 'Lane')
                for key in ('Speed', 'Occupancy'): element(lane_el, key, lane.get(key))
                for vehicle in lane.get('Vehicles', []):
                    element(ET.SubElement(lane_el, 'Vehicle'), 'Volume', vehicle.get('Volume'))
    return ET.tostring(root)

def compact_day(day, static_items, live_items):
    metadata = {v['VDID']: v for v in static_items if inside(v.get('PositionLon'), v.get('PositionLat'))}
    if not metadata: raise ValueError('No historical metadata inside study area')
    grouped = {}; counts = dict(input_records=0, outside_day=0, outside_area=0, off_sample=0, duplicates=0)
    for item in live_items:
        counts['input_records'] += 1
        stamp = datetime.fromisoformat(item['DataCollectTime'])
        if stamp.tzinfo is None: raise ValueError('Observation time has no time zone')
        stamp = stamp.astimezone(TZ)
        if stamp.date().isoformat() != day:
            counts['outside_day'] += 1; continue
        if item['VDID'] not in metadata:
            counts['outside_area'] += 1; continue
        if stamp.minute % 15 or stamp.second or stamp.microsecond:
            counts['off_sample'] += 1; continue
        observations = grouped.setdefault(stamp.isoformat(), {})
        if item['VDID'] in observations:
            counts['duplicates'] += 1
            if observations[item['VDID']] != item:
                raise ValueError('Conflicting duplicate VD/time; needs review')
        observations[item['VDID']] = item
    xml = static_xml(metadata.values()); sensors = []; sensor_index = {}; frames = []
    for stamp, observations in sorted(grouped.items()):
        road = parse_roads(live_xml(observations.values(), stamp), xml)
        values = []
        for row in sorted(road['rows'], key=lambda r: r['id']):
            if row['id'] not in sensor_index:
                sensor_index[row['id']] = len(sensors)
                sensors.append({k: row[k] for k in METADATA_FIELDS})
            values.append([sensor_index[row['id']], *[row[k] for k in VALUE_FIELDS[1:]]])
        frames.append([stamp, values])
    if not frames: raise ValueError('No actual quarter-hour observations in selected day')
    return dict(schema_version=1, day=day, timezone='Asia/Taipei', sampling='exact_quarter_hour_snapshot',
                note='每15分鐘整點的實測快照，非15分鐘平均或累計；缺值不插補。',
                columns=list(VALUE_FIELDS), sensors=sensors, frames=frames, counts=counts)

def publish(payload, output):
    day = payload['day']; name = day + '.json'
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    if len(encoded) > 5_000_000: raise ValueError('Daily output exceeds 5 MB repository budget')
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'index.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(schema_version=1, days=[])
    entry = dict(day=day, file=name, bytes=len(encoded), gzip_bytes=len(gzip.compress(encoded, mtime=0)),
                 sha256=hashlib.sha256(encoded).hexdigest(), frames=len(payload['frames']),
                 sensors=len(payload['sensors']), observations=sum(len(f[1]) for f in payload['frames']),
                 source='TDX Taipei VD', sampling=payload['sampling'])
    manifest['days'] = sorted([d for d in manifest['days'] if d['day'] != day] + [entry], key=lambda d: d['day'])
    # Daily files are separate to avoid rewriting a growing all-history blob.
    if sum(d['bytes'] for d in manifest['days']) > 100_000_000:
        raise ValueError('History exceeds 100 MB repository budget; move older data to external storage')
    path = output / name
    if path.exists() and path.read_bytes() != encoded:
        raise ValueError('Existing immutable day differs; review correction before replacing')
    path.write_bytes(encoded)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return entry

def backfill(day, output, bearer=None):
    if day >= datetime.now(TZ).date().isoformat(): raise ValueError('TDX historical service excludes today')
    cache = ROOT / 'local-data' / 'tdx' / day; cache.mkdir(parents=True, exist_ok=True)
    bearer = bearer or token(); evidence = {}; static = cache / 'static.response'; live = cache / 'live.response'
    meta_path = cache / 'meta.response'
    meta_url = endpoint('Live/VD', day, Meta='true')
    evidence['meta'] = download(meta_url, bearer, meta_path)
    expected = next(records(meta_path))
    if expected.get('Count', 0) <= 0 or expected.get('SizeBytes', MAX_RAW + 1) > MAX_RAW:
        raise ValueError('Empty day or full response exceeds configured raw-data budget')
    for kind, target, top in [('VD', static, 10000), ('Live/VD', live, 2000000)]:
        # A successful full response is cached; interrupted downloads never become cache entries.
        sidecar = target.with_suffix('.evidence.json')
        if target.exists() and sidecar.exists(): evidence[kind] = json.loads(sidecar.read_text())
        else:
            print('Downloading', kind, day, flush=True)
            evidence[kind] = download(endpoint(kind, day, **{'$top': top}), bearer, target)
            sidecar.write_text(json.dumps(evidence[kind], indent=2))
    static_rows = list(records(static))
    if len(static_rows) >= 10000: raise ValueError('Static response may be truncated')
    payload = compact_day(day, static_rows, records(live))
    if payload['counts']['input_records'] >= 2000000: raise ValueError('Live response may be truncated')
    if payload['counts']['input_records'] != expected['Count']:
        raise ValueError('Downloaded row count differs from TDX metadata; do not publish incomplete history')
    payload['source_statistics'] = expected
    payload['sources'] = evidence
    payload['attribution'] = '交通部 TDX／臺北市交通管制工程處；依來源授權條款使用。'
    entry = publish(payload, output)
    return entry

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'history')
    args = parser.parse_args(); day = date.fromisoformat(args.date).isoformat()
    print(json.dumps(backfill(day, args.output), ensure_ascii=False))

if __name__ == '__main__':
    try: main()
    except urllib.error.HTTPError as exc:
        print(f'TDX HTTP {exc.code}; check service entitlement or retry later. Credentials omitted.', file=sys.stderr); sys.exit(1)
    except Exception as exc:
        # Never log network response bodies, OAuth responses, or environment values.
        print(f'Backfill failed ({type(exc).__name__}): {exc}' if isinstance(exc, ValueError) else f'Backfill failed ({type(exc).__name__})', file=sys.stderr); sys.exit(1)
