"""Locate public stops and parking candidates; keep total bays separate from booked bays.
Optional research dependency: pyproj==3.7.2. No dependency is needed to serve the static result.
"""
import argparse
import gzip
import hashlib
import json
import math
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PARKING_IDS=['TPE1956','TPE1964','TPE1794','TPE1781','TPE1556','TPE0654','TPE0627','TPE0442']

def distance(a,b):
    lon1,lat1,lon2,lat2=map(math.radians,[*a,*b])
    q=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000*2*math.asin(min(1,math.sqrt(q)))

def stop_point(s):return [s['StopPosition']['PositionLon'],s['StopPosition']['PositionLat']]

def reference_segment(route,first,last):
    """Trim only the matched main-route reference; never call this a verified new bus path."""
    points=route['reference_geometry']['coordinates']
    start=min(range(len(points)),key=lambda i:distance(points[i],stop_point(first)))
    end=min(range(len(points)),key=lambda i:distance(points[i],stop_point(last)))
    offsets=[distance(points[start],stop_point(first)),distance(points[end],stop_point(last))]
    if start>=end or max(offsets)>150:raise ValueError('Ambiguous reference clipping; manual route check required')
    selected=points[start:end+1]
    return dict(type='LineString',coordinates=selected,reference_only=True,
        length_m=round(sum(distance(a,b) for a,b in zip(selected,selected[1:]))),snap_offsets_m=[round(x,1) for x in offsets])

def prepare(folder,output):
    from pyproj import Transformer
    transformer=Transformer.from_crs('EPSG:3826','EPSG:4326',always_xy=True)
    raw=(folder/'parking.raw').read_bytes();parking=json.loads(raw)['data'];byid={r['id']:r for r in parking['park']}
    route_raw=(folder/'bus_routes.raw').read_bytes()
    route_meta=json.loads(gzip.decompress(route_raw) if route_raw[:2]==b'\x1f\x8b' else route_raw)
    source_routes=json.loads((ROOT/'data/simulation/route-candidates.json').read_text())['routes']
    routes={r['Direction']:r for r in source_routes if r['SubRouteUID']=='TPE10432'}
    notes={
     'TPE1956':('priority','優先查證基地','費率明列大客車，24 小時服務欄位；53 格是全場總數，並非可承租空位。'),
     'TPE1964':('alternative','同區替代基地','同地址的另一筆場地紀錄；與行善六場分別查證，不將兩者直接相加為 83 格可用。'),
     'TPE1794':('alternative','較遠替代基地','費率明列大客車月租；額外空駛、出入口及可承租數仍待確認。'),
     'TPE1781':('conditional','大型車用途待核對','來源寫大型車，費率未明列大客車；不能直接確認可停接駁巴士。'),
     'TPE1556':('conditional','近站但時段待確認','僅 4 個大型車位；服務時間寫一至六 9–17，尚不清楚是否只是收費時段，不能假定晨尖峰可用。'),
     'TPE0654':('excluded','本輪不採用','登載大型車 0 格；小客車立體停車位不當成公車基地。'),
     'TPE0627':('excluded','本輪不採用','登載大型車 0 格、地下停車；不能當成公車休息或停放空間。'),
     'TPE0442':('excluded','本輪不採用','即使是平面空地，登載大型車仍為 0 格；未提出改造或使用許可。')}
    facilities=[]
    for ident in PARKING_IDS:
        r=byid[ident];lon,lat=transformer.transform(float(r['tw97x']),float(r['tw97y']))
        if not(121.5<lon<121.7 and 25<lat<25.2):raise ValueError('Coordinate outside study region')
        status,label,note=notes[ident]
        facilities.append(dict(id=ident,name=r['name'],address=r['address'],coordinates=[lon,lat],
            coordinate_basis='來源 TWD97 / TM2（EPSG:3826）資料點轉 WGS84；不是已核對入口',
            source_xy=[r['tw97x'],r['tw97y']],large_vehicle_bays=r['totalbus'],car_bays=r['totalcar'],
            summary=r['summary'],service_time=r['serviceTime'],fees=r['payex'],status=status,status_label=label,note=note,
            available_bays=None,contracted_bays=0,driver_restroom_verified=False,entrance_verified=False,
            boarding_permission_verified=False,source_id='parking'))
    depot=next(r for r in facilities if r['id']=='TPE1956')
    plans=[]
    for ident,station,startseq,endseq in [('gangqian','港墘',22,17),('xihu','西湖',19,21)]:
        outbound=[s for s in routes[0]['Stops'] if startseq<=s['StopSequence']<=27]
        inbound=[s for s in routes[1]['Stops'] if 12<=s['StopSequence']<=endseq]
        selected=[outbound[0]]+[s for s in outbound if s['StopName']['Zh_tw'] in ['瑞光路','公館山','麗寶大樓','時報廣場']]
        # Morning pilot: single origin boarding, office-area alighting; return demand not inferred.
        plan=dict(id=ident,name=station+'—瑞光路—時報廣場',station=station,
            status='candidate_not_ready',boarding_start=outbound[0],alighting_terminal=outbound[-1],
            return_start=inbound[0],return_terminal=inbound[-1],proposed_stops=selected,
            reference_outbound_stops=outbound,reference_return_stops=inbound,
            outbound_reference=reference_segment(routes[0],outbound[0],outbound[-1]),
            return_reference=reference_segment(routes[1],inbound[0],inbound[-1]),
            base_id='TPE1956',alternative_base_ids=['TPE1964','TPE1794'],
            source_route='藍26主線／方向別參考，不是已核定的新接駁線',
            gaps=[dict(kind='to_base',label='末站到基地：入口與大客車道路待核對',from_coordinates=stop_point(outbound[-1]),to_coordinates=depot['coordinates']),
                  dict(kind='from_base',label='基地到回程起點：進出動線待核對',from_coordinates=depot['coordinates'],to_coordinates=stop_point(inbound[0])),
                  dict(kind='turnaround',label=station+'兩側站牌接續：不可假定原地迴轉',from_coordinates=stop_point(inbound[-1]),to_coordinates=stop_point(outbound[0]))])
        for g in plan['gaps']:
            g['straight_line_m']=round(distance(g['from_coordinates'],g['to_coordinates']))
            g['road_distance_m']=None;g['bus_access_verified']=False
            cache=(ident if g['kind']=='turnaround' else 'gangqian')+'_'+g['kind']
            if (folder/(cache+'.raw')).exists():
                raw_car=(folder/(cache+'.raw')).read_bytes()
                evidence=json.loads((folder/(cache+'.evidence.json')).read_text())
                if hashlib.sha256(raw_car).hexdigest()!=evidence['sha256']:raise ValueError('Car route checksum mismatch')
                car=json.loads(raw_car)
                if car.get('code')!='Ok':raise ValueError('Car route unavailable')
                route=car['routes'][0]
                g['car_reference']=dict(distance_m=route['distance'],geometry=route['geometry'],
                    waypoint_offsets_m=[w['distance'] for w in car['waypoints']],source=evidence,
                    profile='driving',bearing_constrained=False,bus_access_verified=False,
                    limitation='一般汽車路由；未限制站牌離站方向，基地端點不是已核對入口，不代表大客車合法折返。未用導航時間校正模型。')
        plans.append(plan)
    operator=[]
    for name in ['藍26','藍7','棕20','紅3']:
        r=next(r for r in route_meta['BusInfo'] if r['nameZh']==name)
        operator.append({k:r.get(k) for k in ['nameZh','providerName','departureZh','destinationZh','headwayDesc','holidayHeadwayDesc','roadMapUrl']})
    source_evidence=[]
    for name in ['parking','bus_routes']:
        e=json.loads((folder/(name+'.evidence.json')).read_text())
        if e['sha256']!=hashlib.sha256((folder/(name+'.raw')).read_bytes()).hexdigest():raise ValueError('Source checksum mismatch')
        source_evidence.append(dict(id=name,**e))
    source_time=datetime.strptime(parking['UPDATETIME'],'%a %b %d %H:%M:%S CST %Y').replace(tzinfo=ZoneInfo('Asia/Taipei')).isoformat()
    out=dict(schema_version=1,as_of=source_time,source_time_raw=parking['UPDATETIME'],parking_records_examined=len(parking['park']),
        neihu_large_vehicle_facilities=sum(r['area']=='內湖區' and r.get('totalbus',0)>0 for r in parking['park']),
        facilities=facilities,plans=plans,operators=operator,sources=source_evidence,
        route_input_sha256=hashlib.sha256((ROOT/'data/simulation/route-candidates.json').read_bytes()).hexdigest(),
        route_source='https://tdx.transportdata.tw/api/basic/v2/Bus/StopOfRoute/City/Taipei?%24top=10000&%24format=JSON',
        route_snapshot='2026-10-16',projection='pyproj 3.7.2 / EPSG:3826 → EPSG:4326 (always_xy=True)',
        blocked_sources=['https://tpis.gov.taipei/','https://ebus.gov.taipei/','https://overpass-api.de/'],
        blocked_note='開放網域後重試：停車查詢站 403、公車網站 503、Overpass 逾時；未取得入口圖。OSRM 一般汽車路由已取得，另列 car_reference，不能作大客車通行認證。',
        readiness=dict(confirmed_booked_parking_bays=0,confirmed_boarding_bays=0,verified_turnarounds=0,field_travel_time_measured=False,ready_to_operate=False))
    output.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps(dict(facilities=len(facilities),plans=len(plans),references=[(r['id'],r['outbound_reference']['length_m'],r['return_reference']['length_m']) for r in plans]),ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=ROOT/'local-data/sites');p.add_argument('--output',type=Path,default=ROOT/'data/simulation/site-plan.json');a=p.parse_args();prepare(a.input,a.output)
