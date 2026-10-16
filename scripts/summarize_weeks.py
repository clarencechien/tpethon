"""Build small ISO-week summaries from local daily archives; never sum overlapping VD flows."""
import argparse
import hashlib
import json
import statistics
from collections import defaultdict
from datetime import date,datetime,timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PERIODS={'am':(420,570),'pm':(1020,1170),'off':(600,960)}

def valid(row):
    return row['status']=='0' and row['active_lanes']>0 and isinstance(row['speed'],(int,float)) and row['speed']>=0

def decode(payload):
    for stamp,values in payload['frames']:
        dt=datetime.fromisoformat(stamp)
        minute=dt.hour*60+dt.minute
        yield minute,[{**payload['sensors'][v[0]],**dict(zip(payload['columns'][1:],v[1:]))} for v in values]

def stats(rows):
    rows=[r for r in rows if valid(r)]
    if not rows:return {'valid':0,'slow_share':None,'hot_share':None,'mean_speed':None}
    return dict(valid=len(rows),slow_share=sum(r['speed']<20 for r in rows)/len(rows),
                hot_share=sum(r['speed']<20 and isinstance(r['occupancy'],(int,float)) and r['occupancy']>=25 for r in rows)/len(rows),
                mean_speed=statistics.mean(r['speed'] for r in rows))

def average(items):
    good=[s for s in items if s['valid']]
    return dict(valid=sum(s['valid'] for s in good),slow_share=statistics.mean(s['slow_share'] for s in good) if good else None,
                hot_share=statistics.mean(s['hot_share'] for s in good) if good else None,
                mean_speed=statistics.mean(s['mean_speed'] for s in good) if good else None)

def summarize_day(payload):
    frames=list(decode(payload));periods={};corridors={}
    for name,(begin,end) in PERIODS.items():
        selected=[(m,rows) for m,rows in frames if begin<=m<end]
        bins=[{'minute':m,**stats(rows)} for m,rows in selected]
        covered=sum(s['valid']>0 for s in bins);expected=(end-begin)//15
        periods[name]={**average(bins),'covered_bins':covered,'expected_bins':expected,'coverage':covered/expected,'bins':bins}
        by_road=defaultdict(list)
        for _,rows in selected:
            grouped=defaultdict(list)
            for r in rows:grouped[(r['name'],r['direction'])].append(r)
            for key,rs in grouped.items():by_road[key].append(stats(rs))
        corridors[name]=[dict(road=key[0],direction=key[1],**average(values),covered_bins=sum(v['valid']>0 for v in values),expected_bins=expected) for key,values in sorted(by_road.items(),key=lambda kv:str(kv[0]))]
    return dict(day=payload['day'],periods=periods,corridors=corridors,sensors=len(payload['sensors']),frames=len(frames),
                source_count=payload['counts']['input_records'])

def comparison(previous,current,archives):
    result={}
    pairs=[(d,(date.fromisoformat(d)+timedelta(days=7)).isoformat()) for d in previous if date.fromisoformat(d).weekday()<5 and (date.fromisoformat(d)+timedelta(days=7)).isoformat() in current]
    for period,(begin,end) in PERIODS.items():
        before=[];after=[];day_pairs=[];matched_observations=0;matched_bins=0
        for old,new in pairs:
            a=dict(decode(archives[old]));b=dict(decode(archives[new]));left=[];right=[];slots=0;observations=0
            for minute in range(begin,end,15):
                ar={r['id']:r for r in a.get(minute,[]) if valid(r)};br={r['id']:r for r in b.get(minute,[]) if valid(r)}
                common=ar.keys()&br.keys()
                if not common:continue
                left.append(stats([ar[k] for k in common]));right.append(stats([br[k] for k in common]));slots+=1;observations+=len(common)
            if slots/((end-begin)//15)<.8:continue
            before.append(average(left));after.append(average(right));matched_bins+=slots;matched_observations+=observations
            day_pairs.append(dict(previous=old,current=new,paired_bins=slots,paired_observations=observations))
        before_stats=average(before);after_stats=average(after)
        result[period]=dict(day_pairs=day_pairs,previous=before_stats,current=after_stats,paired_bins=matched_bins,paired_observations=matched_observations,
                            difference_percentage_points=(after_stats['slow_share']-before_stats['slow_share'])*100 if before else None,
                            causal_effect=False,weather_adjusted=False)
    return result

def build(as_of,input_dir,output,calendar_path=None):
    monday=as_of-timedelta(days=as_of.weekday());starts=[monday-timedelta(days=7),monday]
    archives={};calendar={};calendar_sources=[]
    if calendar_path and calendar_path.exists():
        reference=json.loads(calendar_path.read_text())
        if isinstance(reference,dict):
            calendar_sources=reference['sources'];reference=reference['days']
        else:
            years=sorted({r['date'][:4] for r in reference})
            calendar_sources=[f'https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/{year}.json' for year in years]
        calendar={r['date']:r for r in reference}
    weeks=[]
    for start in starts:
        days=[];source_files=[]
        for n in range(7):
            day=start+timedelta(days=n);name=day.isoformat();path=input_dir/(name+'.json')
            c=calendar.get(day.strftime('%Y%m%d'),{})
            item=dict(day=name,weekday=day.isoweekday(),reference_holiday=c.get('isHoliday'),calendar_note=c.get('description',''),weather='unknown',status='future' if day>as_of else 'not_yet_published' if day==as_of else 'missing')
            if day<as_of and path.exists():
                raw=path.read_bytes();payload=json.loads(raw)
                if payload['day']!=name:raise ValueError('Archive date mismatch')
                archives[name]=payload;item.update(summarize_day(payload));item['status']='available'
                source_files.append(dict(day=name,sha256=hashlib.sha256(raw).hexdigest(),raw_sources=payload['sources']))
            days.append(item)
        available=[d for d in days if d['status']=='available']
        totals={p:{**average([d['periods'][p] for d in available]),'available_days':len(available),'covered_bins':sum(d['periods'][p]['covered_bins'] for d in available),'expected_bins_available_days':sum(d['periods'][p]['expected_bins'] for d in available)} for p in PERIODS}
        hotspots={}
        for period in PERIODS:
            groups=defaultdict(list)
            for d in available:
                if d['weekday']>5 or d['reference_holiday'] is True:continue
                for corridor in d['corridors'][period]:
                    if corridor['covered_bins']/corridor['expected_bins']>=.8:
                        groups[(corridor['road'],corridor['direction'])].append(corridor)
            candidates=[dict(road=k[0],direction=k[1],observed_days=len(v),**average(v)) for k,v in groups.items() if len(v)>=3]
            hotspots[period]=sorted([c for c in candidates if c['hot_share'] is not None and c['hot_share']>0],key=lambda c:(-c['hot_share'],c['mean_speed']))[:10]
        week=dict(schema_version=1,start=start.isoformat(),end=(start+timedelta(days=6)).isoformat(),as_of=as_of.isoformat(),available_days=len(available),calendar_days=7,
                  complete=len(available)==7,days=days,periods=totals,hotspot_candidates=hotspots,sources=source_files,
                  aggregation='Equal weight per observed 15-minute snapshot within day, then equal weight per available day. Week totals include weekends; use matched comparison for weekdays.',
                  limitations=['每15分鐘整點抽樣，非連續交通量或排隊長度','不同測站不加總為入區車流','雨量、事故、工程尚未控制','行事曆為社群鏡像參考，非企業出勤紀錄'])
        weeks.append(week)
    old=[d['day'] for d in weeks[0]['days'] if d['status']=='available' and d['reference_holiday'] is not True];new=[d['day'] for d in weeks[1]['days'] if d['status']=='available' and d['reference_holiday'] is not True]
    matched=comparison(old,new,archives)
    output.mkdir(parents=True,exist_ok=True)
    files=[]
    for week in weeks:
        filename=week['start']+'.json';data=json.dumps(week,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode();(output/filename).write_bytes(data)
        files.append(dict(file=filename,start=week['start'],end=week['end'],available_days=week['available_days'],complete=week['complete'],bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
    index=dict(schema_version=1,as_of=as_of.isoformat(),timezone='Asia/Taipei',weeks=files,matched_weekdays=matched,
               latest_available_day=max(archives,default=None),calendar_sources=calendar_sources,
               calendar_verified_official=False,calendar_sha256=hashlib.sha256(calendar_path.read_bytes()).hexdigest() if calendar else None)
    (output/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    return index

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of',required=True,type=date.fromisoformat)
    parser.add_argument('--input',type=Path,default=ROOT/'local-data'/'weekly-history')
    parser.add_argument('--output',type=Path,default=ROOT/'data'/'weeks')
    parser.add_argument('--calendar',type=Path)
    args=parser.parse_args();print(json.dumps(build(args.as_of,args.input,args.output,args.calendar),ensure_ascii=False))
