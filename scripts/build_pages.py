"""Build a self-contained GitHub Pages site with source-dated real observations."""
import argparse
import gzip
import json
import shutil
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from dashboard import collect, parse_roads

PREVIOUS_URL='https://clarencechien.github.io/tpethon/data/dashboard.json'

def merge_frames(previous,current):
    cutoff=datetime.fromisoformat(current['captured_at'])-timedelta(days=7)
    frames=[]
    for frame in previous:
        try:
            if datetime.fromisoformat(frame['captured_at'])>=cutoff and isinstance(frame['road']['rows'],list):frames.append(frame)
        except (KeyError,ValueError,TypeError):continue
    # Retain failed acquisitions as gaps. Never show old data as a successful new capture.
    frames.append(dict(captured_at=current['captured_at'],road=current['road']))
    unique={}
    for frame in frames:
        key=frame['road'].get('timestamp') or frame['captured_at']
        unique[key]=frame
    return sorted(unique.values(),key=lambda f:f['captured_at'])[-336:]

def archive_frames(directory):
    manifest=directory/'latest.json'
    database=directory/'transport.sqlite'
    if not database.exists():return []
    import sqlite3
    db=sqlite3.connect(database)
    metadata=db.execute("SELECT file FROM fetches WHERE source='vd_static' AND error IS NULL ORDER BY fetched_at DESC LIMIT 1").fetchone()
    if not metadata:
        db.close();return []
    static=gzip.decompress((directory/metadata[0]).read_bytes())
    frames=[]
    for captured,filename in db.execute("SELECT fetched_at,file FROM fetches WHERE source='vd' AND error IS NULL ORDER BY fetched_at"):
        frames.append(dict(captured_at=captured,road=parse_roads(gzip.decompress((directory/filename).read_bytes()),static)))
    db.close()
    return frames

def build(output,with_history=False,seed_archive=None):
    seed=ROOT/'docs'/'research'/'pages_history_seed.json'
    previous=archive_frames(seed_archive) if seed_archive else (json.loads(seed.read_text()) if seed.exists() else [])
    if with_history:
        try:
            with urllib.request.urlopen(PREVIOUS_URL,timeout=20) as r:
                old=json.load(r)
            previous+=old.get('frames',[])
        except Exception as e:
            # An already-published site's network error must not erase the accumulated history.
            # 404 is expected only before the first publication.
            from urllib.error import HTTPError
            if isinstance(e,HTTPError) and e.code==404:
                print('No previous Pages publication; starting from verified seed observations.',file=sys.stderr)
            else:
                raise RuntimeError('Cannot safely read previous Pages history; preserve the existing publication and retry later.') from e
    # Never remove a user-supplied output directory or unrelated files.
    output.mkdir(parents=True,exist_ok=True)
    for name in ('index.html','map.css','map.js','logic.js','history.js'):
        shutil.copy2(ROOT/'static'/name,output/name)
    shutil.copytree(ROOT/'static'/'vendor',output/'vendor',dirs_exist_ok=True)
    (output/'data').mkdir(exist_ok=True)
    history=ROOT/'data'/'history'
    if history.exists():shutil.copytree(history,output/'data'/'history',dirs_exist_ok=True)
    snapshot=collect()
    payload=dict(schema_version=1,generated_at=snapshot['captured_at'],current=snapshot,frames=merge_frames(previous,snapshot))
    (output/'data'/'dashboard.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')))
    shutil.copy2(ROOT/'docs'/'research'/'metro_od_findings.json',output/'data'/'metro.json')
    (output/'.nojekyll').touch()
    print(json.dumps({'output':str(output),'generated_at':payload['generated_at'],'road_links':len(snapshot['road']['rows']),'bus_stops':len(snapshot['bus']['rows']),'frames':len(payload['frames']),'road_error':snapshot['road'].get('error'),'bus_error':snapshot['bus'].get('error')},ensure_ascii=False))
    return payload

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'_site')
    parser.add_argument('--history',action='store_true',help='Read the previous public Pages snapshot to retain up to seven days.')
    parser.add_argument('--seed-archive',type=Path,help='Seed initial history from an existing collect_transport archive.')
    args=parser.parse_args();build(args.output,args.history,args.seed_archive)
