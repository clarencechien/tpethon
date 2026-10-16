"""Keep route-level official shapes separate from unverified subroute geometry."""
import gzip
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.backfill_tdx import token,download

def line_geometry(wkt):
    match=re.fullmatch(r'LINESTRING\s*\(([^()]+)\)',wkt or '')
    if not match:return None
    try:coords=[[float(v) for v in pair.strip().split()] for pair in match[1].split(',')]
    except ValueError:return None
    if len(coords)<2 or any(len(p)!=2 or not(119<=p[0]<=123 and 21<=p[1]<=26) for p in coords):return None
    return dict(type='LineString',coordinates=coords)

def prepare():
    folder=ROOT/'local-data'/'fleet';folder.mkdir(parents=True,exist_ok=True)
    candidates=json.loads((ROOT/'data/simulation/candidate-bus-stops.json').read_text())
    sources=[];shapes=[];bearer=None
    for name in sorted({r['RouteName']['Zh_tw'] for r in candidates}):
        url='https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/Taipei/'+quote(name)+'?%24format=JSON'
        path=folder/(name+'.json');ev=folder/(name+'.evidence.json')
        try:
            if not path.exists():
                bearer=bearer or token();raw=folder/(name+'.response');evidence=download(url,bearer,raw)
                body=raw.read_bytes();body=gzip.decompress(body) if body[:2]==b'\x1f\x8b' else body
                rows=json.loads(body.decode('utf-8-sig'))
                if not isinstance(rows,list):raise ValueError('Expected array')
                evidence['fetched_at']=datetime.now(timezone.utc).isoformat()
                path.write_text(json.dumps(rows,ensure_ascii=False));ev.write_text(json.dumps(evidence))
            rows=json.loads(path.read_text());shapes.extend(rows);sources.append(json.loads(ev.read_text()))
            print(name,len(rows),'shape records',flush=True)
        except Exception as exc:
            sources.append(dict(url=url,error=type(exc).__name__))
            print(name,type(exc).__name__,flush=True)
    routes=[]
    for r in candidates:
        matches=[s for s in shapes if s.get('SubRouteUID')==r['SubRouteUID'] and s.get('Direction')==r['Direction'] and s.get('RouteUID')==r['RouteUID']]
        geom=line_geometry(matches[0].get('Geometry')) if len(matches)==1 else None
        reference=[s for s in shapes if s.get('RouteUID')==r['RouteUID'] and s.get('Direction')==r['Direction'] and s.get('RouteName',{}).get('Zh_tw')==r['RouteName']['Zh_tw']]
        reference_geom=line_geometry(reference[0].get('Geometry')) if len(reference)==1 else None
        routes.append(dict(**r,geometry=geom,geometry_status='exact_subroute_direction' if geom else 'unmatched',
            geometry_time=matches[0].get('UpdateTime') if geom else None,
            reference_geometry=reference_geom,reference_time=reference[0].get('UpdateTime') if reference_geom else None))
    out=dict(as_of=datetime.now(timezone.utc).isoformat(),routes=routes,sources=sources,
        stops_sha256=hashlib.sha256((ROOT/'data/simulation/candidate-bus-stops.json').read_bytes()).hexdigest(),
        stops_source='https://tdx.transportdata.tw/api/basic/v2/Bus/StopOfRoute/City/Taipei?%24top=10000&%24format=JSON',
        stops_snapshot='2026-10-16',note='官方既有路線及站序；非已驗證接駁迴圈。線形只採相同 RouteUID、SubRouteUID、Direction 的唯一匹配，未匹配者的主路線參考線另存，不能當作子路線行駛路徑。')
    (ROOT/'data/simulation/route-candidates.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
    print('matched',sum(r['geometry'] is not None for r in routes),'/',len(routes))
if __name__=='__main__':prepare()
