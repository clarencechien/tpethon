"""Build small, public simulation inputs; do not infer missing OD or traffic signals."""
import argparse
import hashlib
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from live import inside,txt

SOURCES={
 'sections.xml':'https://tcgbusfs.blob.core.windows.net/blobtisv/Section.xml',
 'section-links.xml':'https://tcgbusfs.blob.core.windows.net/blobtisv/SectionLink.xml',
 'section-geometry.json':'https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/SectionShape/City/Taipei?%24top=10000&%24format=JSON',
 'schedule-blue26.json':'https://tdx.transportdata.tw/api/basic/v2/Bus/Schedule/City/Taipei/%E8%97%8D26?%24top=1000&%24format=JSON',
 'schedule-brown20.json':'https://tdx.transportdata.tw/api/basic/v2/Bus/Schedule/City/Taipei/%E6%A3%9520?%24top=1000&%24format=JSON',
 's2s-blue26.json':'https://tdx.transportdata.tw/api/basic/v2/Bus/S2STravelTime/City/Taipei/10432?%24top=10000&%24format=JSON',
 'weather-sample.json':'https://tdx.transportdata.tw/api/historical/v1/Weather/Observation/AWS?Dates=2026-10-15&%24top=100&%24format=json',
}

def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')

def prepare(folder,output):
    output.mkdir(parents=True,exist_ok=True)
    evidence=[]
    for name,url in SOURCES.items():
        path=folder/name
        if path.exists():evidence.append(dict(file=name,url=url,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    sections={txt(s,'SectionID'):s for s in ET.parse(folder/'sections.xml').findall('.//{*}Section')}
    link_map={txt(s,'SectionID'):[l.text for l in s.findall('.//{*}LinkID')] for s in ET.parse(folder/'section-links.xml').findall('.//{*}SectionLink')}
    shapes=json.loads((folder/'section-geometry.json').read_text())
    features=[]
    for shape in shapes['SectionShapes']:
        geometry=shape['Geometry']
        if not geometry.startswith('LINESTRING('):raise ValueError('Review unsupported geometry before using it')
        coords=[[float(x) for x in pair.split()] for pair in geometry[len('LINESTRING('):-1].split(',')]
        if not any(inside(*xy) for xy in coords):continue
        section=sections.get(shape['SectionID'])
        if section is None:continue
        features.append(dict(type='Feature',geometry=dict(type='LineString',coordinates=coords),properties=dict(
            section_id=shape['SectionID'],name=txt(section,'RoadName'),direction=txt(section,'RoadDirection'),
            length_km=float(txt(section,'SectionLength')),from_node=section.findtext('.//{*}RoadSection/{*}Start'),
            to_node=section.findtext('.//{*}RoadSection/{*}End'),link_ids=link_map.get(shape['SectionID'],[]),
            topology_validated=False)))
    write(output/'road-sections.geojson',dict(type='FeatureCollection',features=features,source_time=shapes.get('UpdateTime'),
         note='僅篩選至少一個線形節點位於研究範圍的發布路段；不是完整可路由路網，尚未核對轉向、層級與號誌。'))
    stops=json.loads((folder/'route-stops.json').read_text());names={'藍26','棕20','紅3','藍7'}
    candidates=[]
    for r in stops:
        if r['RouteName']['Zh_tw'] not in names:continue
        candidates.append({k:r[k] for k in ('RouteUID','RouteID','SubRouteUID','Direction','RouteName','SubRouteName','Stops') if k in r})
    write(output/'candidate-bus-stops.json',candidates)
    summaries=[]
    for name in ('schedule-blue26','schedule-brown20'):
        for route in json.loads((folder/(name+'.json')).read_text()):
            days={}
            for weekday in ('Monday','Tuesday','Wednesday','Thursday','Friday'):
                trips=[]
                for trip in route.get('Timetables',[]):
                    if trip['ServiceDay'].get(weekday)==1 and trip.get('StopTimes'):
                        trips.append(trip['StopTimes'][0]['DepartureTime'])
                days[weekday]=dict(explicit_departures=len(trips),am=sum('07:00'<=t<'09:30' for t in trips),pm=sum('17:00'<=t<'19:30' for t in trips))
            summaries.append(dict(route=route['RouteName']['Zh_tw'],route_uid=route['RouteUID'],subroute_uid=route['SubRouteUID'],
                 direction=route['Direction'],source_time=route['UpdateTime'],explicit_timetable=days,frequency_records=len(route.get('Frequencys',[])),
                 note='僅本次回傳的子路線／方向；明列班次可能不含班距式班次，非全線總供給或實際運行。'))
    s2s=json.loads((folder/'s2s-blue26.json').read_text())
    travel=[]
    for route in s2s:
        for period in route['TravelTimes']:
            if period['Weekday'] not in (1,2,3,4,5) or period['StartHour'] not in (7,8,9,17,18,19):continue
            values=[x['RunTime'] for x in period['S2STimes']]
            travel.append(dict(subroute_uid=route['SubRouteUID'],direction=route['Direction'],weekday=period['Weekday'],start_hour=period['StartHour'],segments=len(values),
                               known_segments=sum(v>=0 for v in values),sum_estimated_seconds=sum(values) if values and all(v>=0 for v in values) else None))
    write(output/'bus-service-summary.json',dict(schedules=summaries,travel_time=travel,
          note='站間 RunTime 為來源預估行駛時間。班表與站間時間的 SubRouteUID 不同，尚未配對，不能相加為真實往返循環。'))
    weather=json.loads((folder/'weather-sample.json').read_text());near=[r for r in weather if inside(r.get('LonWGS84',r.get('Lon')),r.get('LatWGS84',r.get('Lat')))]
    status=dict(schema_version=1,as_of='2026-10-16',model_status='capacity_accounting_only',items=[
      dict(label='道路 VD',status='已取得歷史，週摘要另附',detail='以官方來源時間、方向與有效車道建立基準；沒有將多個 VD 車流加總為入區人數。'),
      dict(label='道路線形與路段代碼',status='部分到位',detail=f'{len(features)} 個研究區候選路段，保留端點代碼與 LinkID；缺完整轉向、號誌、車道連接及外圍繞道路網。'),
      dict(label='公車站序與班表',status='部分到位',detail=f'已篩出 {len(candidates)} 個藍26／棕20／紅3／藍7 路線方向變體；藍26、棕20班表與藍26站間預估時間已取得。不同子路線尚不能拼成往返時間。'),
      dict(label='捷運 OD',status='已有歷史彙整',detail='2026-09 西湖與港墘晨間需求可作接駁參考；不是開車族需求或列車剩餘容量。'),
      dict(label='天氣',status='尚未完成',detail=f'TDX 歷史氣象抽樣取得 {len(weather)} 筆，研究範圍內 {len(near)} 筆，不能當作內湖兩週雨量，週摘要標示未知。'),
      dict(label='起終點需求、車輛乘員與轉乘意願',status='待補',detail='需企業通勤調查、匿名聚合旅次或有約束的 OD 估計；Plan 目前人次為可調假設。'),
      dict(label='號誌、容量、轉向、駕駛休息與折返空間',status='待補',detail='未取得前不發布限行後車速、排隊與通勤時間改善的數字。')])
    write(output/'readiness.json',status)
    write(output/'source-evidence.json',dict(as_of='2026-10-16',sources=evidence,
        route_stops=dict(url='https://tdx.transportdata.tw/api/basic/v2/Bus/StopOfRoute/City/Taipei?%24top=10000&%24format=JSON',selection='routes with any stop inside study bounds',selected_route_variants=len(stops),selected_unique_routes=len(set(r['RouteUID'] for r in stops))),
        failed_paths=[dict(source='TDX bulk road-link metadata/geometry',result='HTTP 200 HTML Request Rejected, not parsed as data'),dict(source='OSM API map bbox',result='connection failed; no OSM road network acquired')]))
    print(json.dumps({'road_sections':len(features),'candidate_bus_variants':len(candidates),'schedule_records':len(summaries),'travel_time_periods':len(travel),'weather_roi_rows':len(near)},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,default=ROOT/'local-data'/'simulation');parser.add_argument('--output',type=Path,default=ROOT/'data'/'simulation');args=parser.parse_args();prepare(args.input,args.output)
