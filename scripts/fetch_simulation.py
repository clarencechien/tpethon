"""Fetch/cache reference inputs for prepare_simulation.py; credentials remain local."""
import gzip
import json
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.backfill_tdx import token,download
from scripts.prepare_simulation import SOURCES
from live import fetch,inside

folder=ROOT/'local-data'/'simulation';folder.mkdir(parents=True,exist_ok=True)
bearer=None
for name,url in SOURCES.items():
    target=folder/name
    if target.exists():continue
    if url.startswith('https://tdx.transportdata.tw/'):
        bearer=bearer or token();raw=target.with_suffix('.response');evidence=download(url,bearer,raw);body=raw.read_bytes()
        body=gzip.decompress(body) if body[:2]==b'\x1f\x8b' else body
        json.loads(body.decode('utf-8-sig')) # Reject HTML error pages, including HTTP 200 WAF responses.
        target.write_bytes(body);target.with_suffix('.evidence.json').write_text(json.dumps(evidence))
    else:target.write_bytes(fetch(url))
    print('Saved',name,flush=True);time.sleep(3)
route_path=folder/'route-stops.json'
if not route_path.exists():
    bearer=bearer or token();url='https://tdx.transportdata.tw/api/basic/v2/Bus/StopOfRoute/City/Taipei?%24top=10000&%24format=JSON'
    raw=folder/'route-stops.response';download(url,bearer,raw);body=raw.read_bytes();body=gzip.decompress(body) if body[:2]==b'\x1f\x8b' else body
    rows=json.loads(body.decode('utf-8-sig'))
    if len(rows)>=10000:raise ValueError('Route-stop response may be truncated')
    selected=[r for r in rows if any(inside(s.get('StopPosition',{}).get('PositionLon'),s.get('StopPosition',{}).get('PositionLat')) for s in r['Stops'])]
    route_path.write_text(json.dumps(selected,ensure_ascii=False,separators=(',',':')))
