"""Download previous/current ISO-week history locally, without committing raw data."""
import argparse
import json
import sys
import time
from datetime import date,datetime,timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.backfill_tdx import backfill,token,TZ

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of',type=date.fromisoformat,required=True)
    args=parser.parse_args()
    if args.as_of>datetime.now(TZ).date():raise ValueError('as-of cannot be in the future')
    monday=args.as_of-timedelta(days=args.as_of.weekday())
    begin=monday-timedelta(days=7);end=args.as_of-timedelta(days=1)
    output=ROOT/'local-data'/'weekly-history';output.mkdir(parents=True,exist_ok=True)
    bearer=None;results=[]
    for n in range((end-begin).days+1):
        day=(begin+timedelta(days=n)).isoformat()
        if (output/(day+'.json')).exists():
            print(day,'cached',flush=True);results.append({'day':day,'status':'cached'});continue
        try:
            # Reuse the token and allow only one historical download at a time.
            bearer=bearer or token()
            result=backfill(day,ROOT/'local-data'/'weekly-staging'/day,bearer)
            (output/(day+'.json')).write_bytes((ROOT/'local-data'/'weekly-staging'/day/(day+'.json')).read_bytes())
            results.append({'day':day,'status':'ok','bytes':result['bytes']})
            print(json.dumps(results[-1]),flush=True)
        except Exception as exc:
            results.append({'day':day,'status':'failed','error_type':type(exc).__name__,'http_status':getattr(exc,'code',None)})
            print(json.dumps(results[-1]),flush=True)
        (output/'download-results.json').write_text(json.dumps(results,indent=2))
        time.sleep(3)
    (output/'download-results.json').write_text(json.dumps(results,indent=2))
    if any(r['status']=='failed' for r in results):raise SystemExit(1)

if __name__=='__main__':main()
