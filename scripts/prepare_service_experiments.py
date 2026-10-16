"""Freeze station/hour OD aggregates and consecutive ramp Volume observations.

Volume is retained in its native source unit. It is not arrival demand, and its
reporting interval is not inferred from UpdateInterval. Missing minutes stay null.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.corridor_experiment import TZ, fetch_file, metadata, number, observation, write
VD='VD-N1-S-16-I-WS-1-內湖-成功路'
LINK='0000101010070A'


def metro_input(path, reference):
    raw=path.read_bytes();source=json.loads(raw)
    rows=[r for r in source['rows'] if r['metric']=='destinations' and r['station'] in ('西湖','港墘')]
    dates=sorted({r['date'] for r in rows});lookup={}
    for row in rows:
        key=(row['date'],row['station'],row['hour'])
        if key in lookup or number(row['value']) is None or int(row['value'])!=row['value']:
            raise ValueError('Duplicate or invalid station/hour count')
        lookup[key]=row['value']
    if len(dates)!=reference['weekdays'] or sum(lookup.values())!=reference['total_journeys']:
        raise ValueError('Station/hour data disagree with independently aggregated OD reference')
    daily=[]
    for day in dates:
        stations=[]
        for station in ('西湖','港墘'):
            keys=[(day,station,h) for h in (7,8,9)]
            if any(key not in lookup for key in keys):raise ValueError('Missing station/hour cohort')
            stations.append(dict(name=station,hourly=[lookup[key] for key in keys]))
        daily.append(dict(day=day,stations=stations))
    mean=[dict(name=name,hourly=[sum(d['stations'][i]['hourly'][h] for d in daily)/len(daily) for h in range(3)]) for i,name in enumerate(('西湖','港墘'))]
    return dict(month=source['month'],weekdays=len(dates),entry_hours=[7,8,9],total_journeys=sum(lookup.values()),
                mean_stations=mean,daily=daily,source=source['source'],input_sha256=hashlib.sha256(raw).hexdigest(),
                input_file='local-data/metro.json',input_rows=source['input_rows'],
                note='07–10 時進站且目的地為兩站的週一至週五旅次；未排除假日。不是到站時間、接駁需求或汽車轉移量。')


def ramp_observation(raw, stamp):
    root=ET.fromstring(gzip.decompress(raw))
    matches=[v for v in root.findall('.//{*}VDLive') if v.findtext('{*}VDID')==VD]
    if len(matches)!=1:return dict(time=stamp.isoformat(),volume=None,speed=None,occupancy=None,reason='missing_or_duplicate_vd')
    vd=matches[0];links=[l for l in vd.findall('.//{*}LinkFlow') if l.findtext('{*}LinkID')==LINK]
    if len(links)!=1:return dict(time=stamp.isoformat(),volume=None,speed=None,occupancy=None,reason='missing_or_duplicate_link')
    link=links[0];result=observation(vd,link,stamp)
    counts=[];by_type={}
    for lane in link.findall('.//{*}Lane'):
        vehicles=lane.findall('.//{*}Vehicle')
        if not vehicles:counts.append(None)
        for v in vehicles:
            volume=number(v.findtext('{*}Volume'));counts.append(volume)
            kind=v.findtext('{*}VehicleType','unknown')
            if volume is not None:by_type[kind]=by_type.get(kind,0)+volume
    valid=all(n is not None for n in counts) and bool(counts) and result['reason'] not in ('invalid_time','stale','invalid_status')
    result.update(volume=sum(counts) if valid else None,vehicle_types=by_type if valid else None)
    if not valid:result['volume_reason']='invalid_counts_or_status_or_time'
    return result


def build(download=False):
    out=ROOT/'data/simulation/service-inputs.json';cache=ROOT/'local-data/corridor'
    reference=json.loads((ROOT/'docs/research/metro_od_findings.json').read_text())
    data=dict(schema_version=1,generated_at=datetime.now(TZ).isoformat(),metro=metro_input(ROOT/'local-data/metro.json',reference),
              ramp=dict(vd_id=VD,link_id=LINK,days=[],unit_verified=False,arrivals_measured=False,
                        note='原始 Volume 僅用於相對通過型態；尚未核實統計區間，也不是上游到達需求。不得當每分鐘進區車輛或用來反推真實排隊。'),sources=[])
    jobs=[]
    for day in ('2026-10-14','2026-10-15'):
        raw,record=fetch_file(cache,day.replace('-','')+'/VD_0000.xml.gz',download)
        data['sources'].append(record)
        if raw is None:raise ValueError('Missing dated ramp metadata')
        sensor=metadata(raw)[VD+':'+LINK]
        times=[datetime.fromisoformat(day+'T16:30:00+08:00')+timedelta(minutes=i) for i in range(241)]
        data['ramp']['days'].append(dict(day=day,sensor=sensor,observations=[]))
        for stamp in times:jobs.append((day,stamp))
    def get(job):
        day,stamp=job;name=day.replace('-','')+'/VDLive_'+(stamp+timedelta(minutes=1)).strftime('%H%M')+'.xml.gz'
        raw,record=fetch_file(cache,name,download)
        row=ramp_observation(raw,stamp) if raw else dict(time=stamp.isoformat(),volume=None,speed=None,occupancy=None,reason='fetch_failed')
        return day,row,record
    by_day={d['day']:d for d in data['ramp']['days']}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i,(day,row,record) in enumerate(pool.map(get,jobs),1):
            by_day[day]['observations'].append(row);data['sources'].append(record)
            if i%40==0:print(f'Ramp sources processed: {i}/{len(jobs)}',flush=True)
    for day in data['ramp']['days']:
        rows=day['observations'];valid=sum(r['volume'] is not None for r in rows)
        consecutive=all((datetime.fromisoformat(b['time'])-datetime.fromisoformat(a['time'])).total_seconds()==60 for a,b in zip(rows,rows[1:]))
        day.update(valid_volume=valid,expected=len(rows),complete=valid==len(rows) and consecutive,
                   valid_speed=sum(r['speed'] is not None for r in rows),timestamps_consecutive=consecutive)
        # Sum is a normalization denominator in unspecified native units, never called vehicles.
        if day['complete']:
            # 20:30 is an end-boundary observation, not an extra arrival minute.
            total=sum(r['volume'] for r in rows[:-1])
            day['relative_weights']=[r['volume']/total for r in rows[:-1]] if total>0 else None
        else:day['relative_weights']=None
    write(out,data)
    print(json.dumps(dict(output=str(out),bytes=out.stat().st_size,metro_total=data['metro']['total_journeys'],
      ramp=[{k:d[k] for k in ('day','valid_volume','expected','complete','valid_speed')} for d in data['ramp']['days']],
      failed_sources=sum('error' in s for s in data['sources'])),ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--download',action='store_true');args=parser.parse_args();build(args.download)
