"""Adapters verified against Taipei public feeds. Native metrics remain separate."""
import gzip
import io
import json
import math
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Taipei')
BASE = 'https://tcgbusfs.blob.core.windows.net/'
FEEDS = {'vd':BASE+'blobtisv/VDLive.xml', 'vd_static':BASE+'blobtisv/VD.xml', 'bus':BASE+'blobbus/GetEstimateTime.gz', 'stops':BASE+'blobbus/GetStop.gz', 'routes':BASE+'blobbus/GetRoute.gz'}
_cache = {}
_lock = threading.Lock()

def fetch(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        raw = r.read(25_000_001)
    if len(raw)>25_000_000:
        raise ValueError('資料過大')
    if raw[:2]==b'\x1f\x8b':
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as f:raw=f.read(40_000_001)
        if len(raw)>40_000_000:raise ValueError('解壓縮資料過大')
    return raw

def txt(node, name):
    return node.findtext('{*}'+name)

def number(value):
    try:
        n=float(value)
        return n if math.isfinite(n) and n>=0 else None
    except (TypeError,ValueError):return None

def inside(lon, lat):
    try:return 121.54<=float(lon)<=121.63 and 25.045<=float(lat)<=25.105
    except (TypeError,ValueError):return False

def freshness(value):
    dt=datetime.fromisoformat(value.replace('/', '-').replace(' ', 'T'))
    if dt.tzinfo is None:dt=dt.replace(tzinfo=TZ)
    age=(datetime.now(TZ)-dt).total_seconds()
    return dict(timestamp=dt.isoformat(),stale=age>600 or age < -120)

def roads(raw, metadata):
    root=ET.fromstring(raw)
    locations={txt(v,'VDID'):v for v in ET.fromstring(metadata).findall('.//{*}VD')}
    result=[]
    for v in root.findall('.//{*}VDLive'):
        ident=txt(v,'VDID'); info=locations.get(ident)
        if info is None or not inside(txt(info,'PositionLon'),txt(info,'PositionLat')):continue
        stamp=freshness(txt(v,'DataCollectTime'))
        valid=txt(v,'Status')=='0'
        volumes=[number(txt(x,'Volume')) for x in v.findall('.//{*}Vehicle')]
        speeds=[number(txt(x,'Speed')) for x in v.findall('.//{*}Lane')]
        speeds=[s for s in speeds if s is not None]
        total=sum(volumes) if valid and volumes and all(x is not None for x in volumes) else None
        result.append(dict(id=ident,name=txt(info,'RoadName'),lon=number(txt(info,'PositionLon')),lat=number(txt(info,'PositionLat')),volume=total,speed=sum(speeds)/len(speeds) if valid and speeds else None,status=txt(v,'Status'),**stamp))
    return dict(rows=result,**freshness(txt(root,'UpdateTime')),interval_seconds=txt(root,'UpdateInterval'),source=FEEDS['vd'])

def buses(raw, stops_raw, routes_raw):
    payload=json.loads(raw)
    stops={str(s['Id']):s for s in json.loads(stops_raw)['BusInfo']}
    route_names={str(r['Id']):r['nameZh'] for r in json.loads(routes_raw)['BusInfo']}
    rows=[]
    for estimate in payload['BusInfo']:
        stop=stops.get(str(estimate['StopID']))
        if not stop or not inside(stop.get('longitude'),stop.get('latitude')):continue
        eta=number(estimate.get('EstimateTime'))
        rows.append(dict(id=str(estimate['StopID']),name=stop['nameZh'],route=route_names.get(str(estimate['RouteID']),str(estimate['RouteID'])),direction=str(estimate.get('GoBack','')),eta_seconds=eta,raw_status=str(estimate.get('EstimateTime')),lon=number(stop['longitude']),lat=number(stop['latitude'])))
    rows.sort(key=lambda r:r['eta_seconds'] if r['eta_seconds'] is not None else float('inf'))
    return dict(rows=rows,**freshness(payload['EssentialInfo']['UpdateTime']),source=FEEDS['bus'])

def snapshot():
    with _lock:
        if _cache.get('until',0)>time.monotonic():return _cache['value']
        blobs,errors={},{}
        def get(item):
            k,u=item
            try:return k,fetch(u),None
            except Exception as e:return k,None,str(e)[:200]
        with ThreadPoolExecutor(max_workers=5) as pool:
            for k,b,e in pool.map(get,FEEDS.items()):
                if e:errors[k]=e
                else:blobs[k]=b
        result={'fetched_at':datetime.now(TZ).isoformat(),'bounds':[121.54,25.045,121.63,25.105]}
        for mode,keys,parser in [('road',['vd','vd_static'],roads),('bus',['bus','stops','routes'],buses)]:
            try:
                if any(k in errors for k in keys):raise ValueError('; '.join(errors[k] for k in keys if k in errors))
                result[mode]=parser(*(blobs[k] for k in keys))
            except Exception as e:result[mode]={'error':str(e)[:300],'rows':[]}
        _cache.update(until=time.monotonic()+60,value=result)
        return result
