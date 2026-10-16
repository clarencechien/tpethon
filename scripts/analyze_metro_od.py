"""Actual historical origins of morning journeys ending at Xihu/Gangqian."""
import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TARGETS={'西湖','港墘'}

def analyze(reader):
    expected={'日期','時段','進站','出站','人次'}
    if not expected.issubset(reader.fieldnames or []):raise ValueError('Unknown metro OD schema')
    origins=defaultdict(int);by_hour=defaultdict(int);daily=defaultdict(int);by_target=defaultdict(int)
    days=set();input_rows=0;calendar={}
    for r in reader:
        input_rows+=1
        hour=int(r['時段'])
        if hour not in (7,8,9):continue
        day=r['日期'].replace('/','-')
        if day not in calendar:calendar[day]=date.fromisoformat(day).weekday()<5
        if not calendar[day]:continue
        days.add(day)
        if r['出站'] not in TARGETS:continue
        value=int(r['人次'])
        if value<0:raise ValueError('Negative passenger count')
        origins[r['進站']]+=value;by_hour[hour]+=value;daily[day]+=value;by_target[r['出站']]+=value
    if not days or not by_target:raise ValueError('No target observations')
    total=sum(origins.values());n=len(days)
    return dict(target_stations=sorted(TARGETS),input_rows=input_rows,weekdays=n,dates=sorted(days),
        calendar_note='Monday–Friday only; public holidays NOT excluded.',
        time_note='07:00–10:00 entry-time cohorts; NOT destination arrival times and NOT 07:00–09:30.',
        total_journeys=total,mean_per_weekday=round(total/n,2),
        target_means={k:round(v/n,2) for k,v in by_target.items()},
        hourly_means={str(k):round(v/n,2) for k,v in sorted(by_hour.items())},
        top_origins=[dict(station=k,total=v,mean_per_weekday=round(v/n,2),share=round(v/total,4) if total else 0) for k,v in sorted(origins.items(),key=lambda kv:kv[1],reverse=True)[:20]],
        daily_totals=dict(sorted(daily.items())))

if __name__=='__main__':
    metadata=json.loads((ROOT/'local-data'/'metro.json').read_text())
    url=metadata['source'];parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='https' or parsed.hostname!='tcgmetro.blob.core.windows.net':raise ValueError('Unexpected source host')
    print('Reading official OD month '+metadata['month'],flush=True)
    with urllib.request.urlopen(url,timeout=60) as response:
        result=analyze(csv.DictReader(io.TextIOWrapper(response,encoding='utf-8-sig')))
    result.update(source=url,month=metadata['month'])
    destination=ROOT/'docs'/'research'/'metro_od_findings.json'
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
