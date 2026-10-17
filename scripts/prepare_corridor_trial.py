"""Cache OSM/OSRM road paths; never interpret routing duration as peak observations."""
import hashlib,json,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def prepare():
    site=json.loads((ROOT/'data/simulation/site-plan.json').read_text());hubs=json.loads((ROOT/'data/simulation/hub-inputs.json').read_text())
    stops_path=ROOT/'local-data/simulation/route-stops.json'
    routes=json.loads(stops_path.read_text());stop=next(s for r in routes for s in r['Stops'] if s['StopUID']=='TPE10760')
    def xy(s):return [s['StopPosition']['PositionLon'],s['StopPosition']['PositionLat']]
    hub=next(h for h in hubs['hubs'] if h['id']=='songshan');dest=site['plans'][0]['alighting_terminal'];base=next(b for b in site['facilities'] if b['id']=='TPE1956')
    points={'origin':dict(name='後山埤站（忠孝）周邊',coordinates=xy(stop),source='TDX '+stop['StopUID']),
            'hub':dict(name='松山車站停車轉乘候選',coordinates=hub['coordinates'],source='官方停車場 '+hub['parking_id']),
            'gate':dict(name='成美橋道路參考點',coordinates=[121.583087,25.052635],source='OSRM 成美橋道路幾何；非官方容量量測點'),
            'destination':dict(name='時報廣場工作點候選',coordinates=xy(dest),source='TDX '+dest['StopUID']),
            'base':dict(name='行善六場基地候選',coordinates=base['coordinates'],source='官方停車場 '+base['id'])}
    specifications={'direct_out':['origin','gate','destination'],'direct_back':['destination','origin'],
                    'hub_out':['hub','gate','destination'],'hub_back':['destination','hub'],'access':['origin','hub'],
                    'base_direct':['base','origin'],'direct_base':['origin','base'],'base_hub':['base','hub'],'hub_base':['hub','base']}
    cache=ROOT/'local-data/corridor-trial';cache.mkdir(parents=True,exist_ok=True);paths={}
    for key,names in specifications.items():
        coords=';'.join(','.join(map(str,points[n]['coordinates'])) for n in names)
        url='https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=true'
        raw_path=cache/(key+'.json');meta_path=cache/(key+'.evidence.json')
        if raw_path.exists() and meta_path.exists():
            raw=raw_path.read_bytes();meta=json.loads(meta_path.read_text());assert meta['url']==url and hashlib.sha256(raw).hexdigest()==meta['sha256']
        else:
            with urllib.request.urlopen(url,timeout=30) as response:raw=response.read()
            meta=dict(url=url,sha256=hashlib.sha256(raw).hexdigest(),fetched_at=datetime.now(timezone.utc).isoformat(),bytes=len(raw))
            raw_path.write_bytes(raw);meta_path.write_text(json.dumps(meta))
        x=json.loads(raw);assert x['code']=='Ok';r=x['routes'][0]
        assert all(w['distance']<100 for w in x['waypoints']), 'Endpoint snapped too far'
        paths[key]=dict(source=meta,distance_km=r['distance']/1000,routing_minutes_not_peak=r['duration']/60,geometry=r['geometry'],leg_km=[l['distance']/1000 for l in r['legs']],road_names=list(dict.fromkeys(s['name'] for l in r['legs'] for s in l['steps'] if s['name'])),snapped_waypoints=[dict(coordinates=w['location'],distance_m=w['distance']) for w in x['waypoints']])
        print(key,round(paths[key]['distance_km'],2),paths[key]['road_names'])
    data=dict(schema_version=1,prepared_at=datetime.now(timezone.utc).isoformat(),calibrated=False,name='後山埤—成美橋—時報廣場',points=points,paths=paths,parking_total=hub['total_car_spaces'],parking_allocated_verified=None,base_total_bus_bays=base['large_vehicle_bays'],base_allocated_verified=None,
        source_files={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ['data/simulation/site-plan.json','data/simulation/hub-inputs.json']},
        stop_source=dict(url=site['route_source'],snapshot=site['route_snapshot'],sha256=hashlib.sha256(stops_path.read_bytes()).hexdigest(),selected_stop=stop),
        road_source='OSM / OSRM driving profile; ODbL; not a legal bus route or peak-time measurement',
        limitations=['停車資料點不是入口；站點與基地未取得使用許可','路徑為小客車路由，未核對大客車轉彎、道路寬度或專用道可行性','反向與基地路徑僅作距離及假設時間，不含反向動態排隊','背景流量、瓶頸容量、車道及需求均未校正'])
    (ROOT/'data/simulation/corridor-trial-inputs.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
if __name__=='__main__':prepare()
