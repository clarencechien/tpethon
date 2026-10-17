"""Build a small E11 evidence pack from official snapshots; no inferred rail seats."""
import gzip,hashlib,json,math,statistics
from datetime import date,datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def distance(stop,point):
 p=stop['StopPosition'];return math.hypot((p['PositionLon']-point[0])*100.8,(p['PositionLat']-point[1])*111.2)*1000

def prepare():
 corridor=ROOT/'data/simulation/corridor-trial-inputs.json';x=json.loads(corridor.read_text());hub=x['points']['hub']['coordinates'];dest=x['points']['destination']['coordinates']
 stops_path=ROOT/'local-data/simulation/route-stops.json';routes=json.loads(stops_path.read_text());public_path=ROOT/'local-data/rail-hub/public-routes.raw';public=json.loads(gzip.decompress(public_path.read_bytes()));evidence=json.loads(public_path.with_suffix('.evidence.json').read_text())
 services=[]
 for r in routes:
  ss=r.get('Stops',[]);pairs=[(i,s,j,t) for i,s in enumerate(ss) if distance(s,hub)<600 for j,t in enumerate(ss) if i<j and distance(t,dest)<250]
  if not pairs:continue
  i,s,j,t=min(pairs,key=lambda v:distance(v[1],hub)+distance(v[3],dest));attrs=[a for a in public['BusInfo'] if str(a['Id'])==r['RouteID']]
  services.append(dict(route_id=r['RouteID'],name=r['RouteName']['Zh_tw'],direction=r['Direction'],subroute_uid=r.get('SubRouteUID'),boarding=dict(id=s['StopID'],name=s['StopName']['Zh_tw'],coordinates=[s['StopPosition']['PositionLon'],s['StopPosition']['PositionLat']],distance_to_hub_m=round(distance(s,hub))),alighting=dict(id=t['StopID'],name=t['StopName']['Zh_tw'],coordinates=[t['StopPosition']['PositionLon'],t['StopPosition']['PositionLat']],distance_to_work_m=round(distance(t,dest))),stop_sequence=[v['StopName']['Zh_tw'] for v in ss[i:j+1]],interstop_segments=j-i,operators=sorted({a['providerName'] for a in attrs}),first_time_raw=attrs[0].get('goFirstBusTime') if attrs else None,last_time_raw=attrs[0].get('goLastBusTime') if attrs else None,service_note=attrs[0].get('busTimeDesc') if attrs else None,map_url=attrs[0].get('roadMapUrl') if attrs else None,verified_station_departures=None,verified_runtime=None))
 ids=['VMBWS20:6001340200020A','VMBWS20:6001340600020A','VMSV820:6004160100000A','VMSV820:6004160500000A','VQEUU60:6005320200050A','VQEUU60:6005320600030A'];by_id={};days=[];sources=[]
 for p in sorted((ROOT/'data/history').glob('2026-10-*.json')):
  if date.fromisoformat(p.stem).weekday()>4:continue
  d=json.loads(p.read_text());days.append(d['day']);sources.append(dict(path=str(p.relative_to(ROOT)),sha256=sha(p),sources=d['sources']))
  sensors={v['id']:(i,v) for i,v in enumerate(d['sensors'])};frame={t[11:16]:rows for t,rows in d['frames']}
  for ident in ids:
   if ident not in sensors:continue
   index,sensor=sensors[ident];out=by_id.setdefault(ident,dict(sensor=sensor,observations=[]))
   for k in range(11):
    minute=420+k*15;clock=f'{minute//60:02}:{minute%60:02}';row=next((r for r in frame.get(clock,[]) if r[0]==index),None);valid=bool(row and row[5]=='0' and row[1] is not None)
    out['observations'].append(dict(day=d['day'],time=clock,speed=row[1] if valid else None,occupancy=row[2] if valid else None,status=row[5] if row else 'missing'))
 for out in by_id.values():
  valid=[o for o in out['observations'] if o['speed'] is not None];low=[o for o in valid if o['speed']<20 and o['occupancy'] is not None and o['occupancy']>=25]
  out['summary']=dict(expected=len(days)*11,valid=len(valid),low_dense=len(low),low_dense_days=len({o['day'] for o in low}),median_speed=statistics.median(o['speed'] for o in valid) if valid else None)
 metro_path=ROOT/'data/simulation/hub-metro.json';metro=json.loads(metro_path.read_text());station=next(o for o in metro['origins'] if o['station']=='松山');journeys=sum(sum(v) for v in station['daily_hourly'])
 fetch_status=json.loads((ROOT/'local-data/rail-hub/fetch-status.json').read_text())
 auth_failures=[r for r in fetch_status if r.get('stage')=='authentication']
 tdx_status='本次授權失敗（'+str(auth_failures[0].get('oauth_error','未明錯誤'))+'）；不代表資料API沒有資料' if auth_failures else '取得狀態見來源紀錄；新回應仍需核對方向、欄位與適用期間'
 result=dict(schema_version=1,prepared_at=datetime.now(timezone.utc).isoformat(),calibrated=False,fetch_status=fetch_status,corridor_input_sha256=sha(corridor),paths={k:x['paths'][k] for k in ['hub_out','hub_back','base_hub','hub_base']},points=x['points'],services=services,route_sources=dict(stops_url=x['stop_source']['url'],stops_snapshot=x['stop_source']['snapshot'],stops_sha256=sha(stops_path),public=evidence,public_source_time=public['EssentialInfo']['UpdateTime']),road_observations=dict(days=days,entry_times='07:00–09:30，每15分鐘單點快照',links=list(by_id.values()),sources=sources,used_as_capacity=False),metro_context=dict(station='捷運松山',targets=metro['targets'],entry_hours=metro['entry_hours'],month=metro['month'],weekdays=len(metro['dates']),journeys=journeys,daily_average=journeys/len(metro['dates']),used_as_rail_demand=False,source=metro['source'],sha256=sha(metro_path)),readiness=dict(bus_routes='官方站序已配對；完整班表、站間尖峰時間與剩餘座位未取得',road_space='OSM查詢回傳406；橋面與路口可用寬度、設站及專用道空間未確認',tdx=tdx_status,train='臺鐵松山站晨間到站班表、下車／轉乘量及剩餘座位未取得',field='候選基地、上客空間與站到站步行時間仍待現勘'))
 (ROOT/'data/simulation/rail-hub-inputs.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
 print('Services',[(r['name'],r['direction'],r['interstop_segments']) for r in services]);print('VD',[(r['sensor']['name'],r['sensor']['direction'],r['summary']) for r in by_id.values()]);print('Metro context',journeys,'/',len(metro['dates']))
if __name__=='__main__':prepare()
