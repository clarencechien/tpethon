"""One-shot public feed archive and lossless lane history. Schedule externally if needed."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from live import FEEDS, fetch, txt, number, inside

EXTRA = {
    'bus_gps': 'https://tcgbusfs.blob.core.windows.net/blobbus/GetBusData.gz',
    'bus_geometry': 'https://tcgbusfs.blob.core.windows.net/blobbus/TstBusShape.json',
    'stop_locations': 'https://tcgbusfs.blob.core.windows.net/blobbus/GetStopLocation.gz',
    'cctv': 'https://tcgbusfs.blob.core.windows.net/blobtisv/CCTV.xml',
}

def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS fetches (
      fetched_at TEXT, source TEXT, url TEXT, sha256 TEXT, source_time TEXT,
      record_count INTEGER, file TEXT, error TEXT, PRIMARY KEY(fetched_at,source));
    CREATE TABLE IF NOT EXISTS detectors (
      vd_id TEXT PRIMARY KEY, road TEXT, lon REAL, lat REAL, road_class TEXT,
      links_json TEXT, source_time TEXT);
    CREATE TABLE IF NOT EXISTS lanes (
      vd_id TEXT, link_id TEXT, lane_id TEXT, observed_at TEXT,
      status TEXT, speed REAL, occupancy REAL, vehicles_json TEXT,
      PRIMARY KEY(vd_id,link_id,lane_id,observed_at));
    ''')

def ingest_xml(db, source, raw):
    root=ET.fromstring(raw)
    stamp=txt(root,'UpdateTime')
    if not stamp:
        raise ValueError('Missing XML UpdateTime; unexpected feed schema')
    datetime.fromisoformat(stamp)
    count=0
    if source=='vd_static':
        for vd in root.findall('.//{*}VD'):
            links=[{x.tag.split('}')[-1]:x.text for x in link} for link in vd.findall('.//{*}DetectionLink')]
            db.execute('INSERT OR REPLACE INTO detectors VALUES (?,?,?,?,?,?,?)',
                       (txt(vd,'VDID'),txt(vd,'RoadName'),number(txt(vd,'PositionLon')),number(txt(vd,'PositionLat')),txt(vd,'RoadClass'),json.dumps(links),stamp))
            count+=1
    elif source=='vd':
        for vd in root.findall('.//{*}VDLive'):
            observed=txt(vd,'DataCollectTime')
            datetime.fromisoformat(observed)
            for link in vd.findall('.//{*}LinkFlow'):
                for lane in link.findall('.//{*}Lane'):
                    vehicles=[{x.tag.split('}')[-1]:x.text for x in v} for v in lane.findall('.//{*}Vehicle')]
                    # Invalid status is retained explicitly; numeric sentinel values become null.
                    valid=txt(vd,'Status')=='0'
                    db.execute('INSERT OR IGNORE INTO lanes VALUES (?,?,?,?,?,?,?,?)',
                        (txt(vd,'VDID'),txt(link,'LinkID'),txt(lane,'LaneID'),observed,txt(vd,'Status'),number(txt(lane,'Speed')) if valid else None,number(txt(lane,'Occupancy')) if valid else None,json.dumps(vehicles)))
                    count+=1
    else:
        count=len(root.findall('.//{*}CCTV'))
    if source in ('vd','vd_static') and count==0:
        raise ValueError('VD feed contains no recognized observations')
    return stamp,count

def run(destination, include_static=True):
    destination.mkdir(parents=True,exist_ok=True)
    (destination/'raw').mkdir(exist_ok=True)
    db=sqlite3.connect(destination/'transport.sqlite')
    initialize(db)
    feeds={**FEEDS,**EXTRA} if include_static else {k:u for k,u in {**FEEDS,**EXTRA}.items() if k in ('vd','bus','bus_gps')}
    now=datetime.now(ZoneInfo('Asia/Taipei')).isoformat()
    records=[]
    def download(item):
        key,url=item
        try:return key,url,fetch(url),None
        except Exception as e:return key,url,None,str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for key,url,raw,error in pool.map(download,feeds.items()):
            record=dict(source=key,url=url,fetched_at=now,error=error)
            sha=stamp=filename=None;count=0
            if raw is not None:
                sha=hashlib.sha256(raw).hexdigest()
                filename=f'raw/{key}-{sha}.gz'
                target=destination/filename
                if not target.exists():
                    temp=target.with_suffix('.tmp')
                    temp.write_bytes(gzip.compress(raw,mtime=0));temp.replace(target)
                try:
                    with db:
                        if key in ('vd','vd_static','cctv'):
                            stamp,count=ingest_xml(db,key,raw)
                        else:
                            payload=json.loads(raw)
                            if isinstance(payload,dict):
                                stamp=payload.get('EssentialInfo',{}).get('UpdateTime')
                                rows=payload.get('BusInfo',payload.get('features',[]))
                                count=len(rows)
                            elif isinstance(payload,list):count=len(payload)
                            else:raise ValueError('Unexpected JSON structure')
                except Exception as e:error='parse: '+str(e)
            record.update(sha256=sha,source_time=stamp,record_count=count,file=filename,error=error)
            with db:db.execute('INSERT INTO fetches VALUES (?,?,?,?,?,?,?,?)',(now,key,url,sha,stamp,count,filename,error))
            records.append(record)
    summary={'fetched_at':now,'sources':records,'lane_observations':db.execute('SELECT count(*) FROM lanes').fetchone()[0],
             'distinct_observation_times':db.execute('SELECT count(DISTINCT observed_at) FROM lanes').fetchone()[0]}
    db.close()
    temp=destination/'latest.tmp';temp.write_text(json.dumps(summary,ensure_ascii=False,indent=2));temp.replace(destination/'latest.json')
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return summary

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'local-data'/'research')
    parser.add_argument('--dynamic-only',action='store_true',help='Use after an initial full capture; static metadata needs a daily refresh.')
    args=parser.parse_args()
    result=run(args.output,not args.dynamic_only)
    raise SystemExit(1 if any(r['error'] for r in result['sources']) else 0)
