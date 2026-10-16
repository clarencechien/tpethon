"""Directional VD observations for the static OSM dashboard; no invented road geometry."""
import json
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo
from live import FEEDS, fetch, inside, number, txt, buses

TZ=ZoneInfo('Asia/Taipei')

def parse_roads(raw, metadata):
    root=ET.fromstring(raw)
    locations={txt(v,'VDID'):v for v in ET.fromstring(metadata).findall('.//{*}VD')}
    rows=[]
    for vd in root.findall('.//{*}VDLive'):
        ident=txt(vd,'VDID');info=locations.get(ident)
        if info is None or not inside(txt(info,'PositionLon'),txt(info,'PositionLat')):continue
        links={txt(x,'LinkID'):x for x in info.findall('.//{*}DetectionLink')}
        for link in vd.findall('.//{*}LinkFlow'):
            lid=txt(link,'LinkID');meta=links.get(lid)
            valid=txt(vd,'Status')=='0'
            occupancy=[];speeds=[];volumes=[];active=0
            for lane in link.findall('.//{*}Lane'):
                occ=number(txt(lane,'Occupancy'))
                if occ is not None and occ<=100:occupancy.append(occ)
                speed=number(txt(lane,'Speed'))
                counts=[number(txt(v,'Volume')) for v in lane.findall('.//{*}Vehicle')]
                volume=sum(counts) if counts and all(v is not None for v in counts) else None
                volumes.append(volume)
                # A zero-speed empty lane is not congestion. Occupancy can still show a standing queue.
                if (volume is not None and volume>0) or (occ is not None and occ>0):
                    active+=1
                    if speed is not None:speeds.append(speed)
            rows.append(dict(id=ident+':'+str(lid),vd_id=ident,link_id=lid,name=txt(info,'RoadName'),
                lat=number(txt(info,'PositionLat')),lon=number(txt(info,'PositionLon')),
                direction=txt(meta,'RoadDirection') if meta is not None else None,
                bearing=txt(meta,'Bearing') if meta is not None else None,
                speed=round(sum(speeds)/len(speeds),1) if valid and speeds else None,
                occupancy=round(sum(occupancy)/len(occupancy),1) if valid and occupancy else None,
                volume=sum(volumes) if valid and volumes and all(v is not None for v in volumes) else None,
                lanes=len(volumes),active_lanes=active,status=txt(vd,'Status'),timestamp=txt(vd,'DataCollectTime')))
    if not rows:raise ValueError('No recognized VD observations in the study area')
    return dict(rows=rows,timestamp=txt(root,'UpdateTime'),source=FEEDS['vd'])

def collect():
    blobs={};errors={}
    def get(item):
        key,url=item
        try:return key,fetch(url),None
        except Exception as e:return key,None,str(e)[:160]
    with ThreadPoolExecutor(max_workers=5) as pool:
        for k,b,e in pool.map(get,FEEDS.items()):
            if e:errors[k]=e
            else:blobs[k]=b
    result=dict(captured_at=datetime.now(TZ).isoformat())
    for mode,keys,parser in [('road',['vd','vd_static'],parse_roads),('bus',['bus','stops','routes'],buses)]:
        try:
            if any(k in errors for k in keys):raise ValueError('; '.join(errors[k] for k in keys if k in errors))
            result[mode]=parser(*(blobs[k] for k in keys))
        except Exception as e:result[mode]=dict(rows=[],error=str(e)[:300])
    # Coalesce route-stop records to actual stop locations, preserving distinct route/direction estimates.
    if not result['bus'].get('error'):
        stops=json.loads(blobs['stops'])['BusInfo']
        physical={str(s['Id']):str(s.get('stopLocationId') or s['Id']) for s in stops}
        grouped={}
        for row in result['bus']['rows']:
            ident=physical.get(row['id'],row['id'])
            node=grouped.setdefault(ident,dict(id=ident,name=row['name'],lat=row['lat'],lon=row['lon'],services=[]))
            service=dict(route=row['route'],direction=row['direction'],eta_seconds=row['eta_seconds'])
            if service not in node['services']:node['services'].append(service)
        result['bus']['rows']=list(grouped.values())
    return result
