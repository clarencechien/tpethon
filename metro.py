"""Fetch official monthly OD data and aggregate selected Wenhu stations, streaming CSV."""
import csv
import io
import json
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

INDEX = 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=eb481f58-1238-4cff-8caa-fa7bb20cb4f4'
STATIONS = {'劍南路','大直','西湖','港墘','文德','內湖','大湖公園','葫洲','東湖','南港軟體園區','南港展覽館'}
DATA = Path(__file__).parent / 'local-data'

def aggregate(reader):
    required={'日期','時段','進站','出站','人次'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('捷運 CSV 欄位與預期不同，需確認：'+str(reader.fieldnames))
    totals=defaultdict(int)
    count=0
    for r in reader:
        count+=1
        day=datetime.strptime(r['日期'].replace('/','-'),'%Y-%m-%d')
        if day.weekday()>4:continue
        hour=int(r['時段'])
        if hour not in (7,8,9):continue
        value=int(r['人次'])
        if value<0:raise ValueError('捷運人次不得為負')
        for field,metric in [('進站','entries'),('出站','destinations')]:
            if r[field] in STATIONS:
                totals[(day.date().isoformat(),hour,r[field],metric)]+=value
    if not totals:raise ValueError('來源沒有選定文湖線站點的平日晨間資料')
    return [dict(date=d,hour=h,station=s,metric=m,value=v) for (d,h,s,m),v in sorted(totals.items())],count

def refresh():
    DATA.mkdir(exist_ok=True)
    try:
        with urllib.request.urlopen(INDEX,timeout=30) as response:
            index=list(csv.DictReader(io.TextIOWrapper(response,encoding='utf-8-sig')))
        latest=max(index,key=lambda r:(int(r['西元年']),int(r['月'])))
        url=latest['URL'].replace('http:','https:',1)
        parsed=urllib.parse.urlparse(url)
        if parsed.scheme!='https' or parsed.hostname!='tcgmetro.blob.core.windows.net':
            raise ValueError('來源下載網址變更，請確認官方新來源')
        print('Downloading official metro month',latest['西元年'],latest['月'],flush=True)
        with urllib.request.urlopen(url,timeout=60) as response:
            rows,count=aggregate(csv.DictReader(io.TextIOWrapper(response,encoding='utf-8-sig')))
        result=dict(rows=rows,source=url,month=f"{int(latest['西元年']):04d}-{int(latest['月']):02d}",input_rows=count)
    except Exception as e:
        result=dict(rows=[],error=str(e)[:300],source=INDEX)
    if result.get('error') and (DATA/'metro.json').exists():
        previous=json.loads((DATA/'metro.json').read_text())
        if previous.get('rows'):
            print('Refresh failed; preserved previous historical data:',result['error'],flush=True)
            return result
    temp=DATA/'metro.tmp'
    temp.write_text(json.dumps(result,ensure_ascii=False))
    temp.replace(DATA/'metro.json')
    print({k:v for k,v in result.items() if k!='rows'},flush=True)
    return result

if __name__=='__main__':
    raise SystemExit(1 if refresh().get('error') else 0)
