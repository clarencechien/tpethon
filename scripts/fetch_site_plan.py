"""Cache official public parking and bus-route references with provenance; no credentials."""
import argparse
import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCES={'parking':'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json',
         'bus_routes':'https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz'}
def fetch(roads=False):
    folder=ROOT/'local-data/sites';folder.mkdir(parents=True,exist_ok=True)
    sources=dict(SOURCES)
    if roads:
        site=json.loads((ROOT/'data/simulation/site-plan.json').read_text())
        for plan in site['plans']:
            for gap in plan['gaps']:
                if plan['id']=='xihu' and gap['kind']!='turnaround':continue
                coords=';'.join(','.join(str(n) for n in p) for p in [gap['from_coordinates'],gap['to_coordinates']])
                sources[plan['id']+'_'+gap['kind']]='https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=true'
    for name,url in sources.items():
        target=folder/(name+'.raw');evidence=folder/(name+'.evidence.json')
        if target.exists() and evidence.exists():
            if hashlib.sha256(target.read_bytes()).hexdigest()!=json.loads(evidence.read_text())['sha256']:raise ValueError('Invalid source cache checksum')
            print('Using cached',name);continue
        with urllib.request.urlopen(url,timeout=30) as response:
            raw=response.read(15000001)
            if len(raw)>15000000:raise ValueError('Reference source exceeds size limit')
            info=dict(url=url,resolved_url=response.url,status=response.status,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),fetched_at=datetime.now(timezone.utc).isoformat())
        target.write_bytes(raw);evidence.write_text(json.dumps(info));print('Saved',name,len(raw))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--roads',action='store_true',help='Also fetch optional car routes using the saved candidate points');fetch(parser.parse_args().roads)
