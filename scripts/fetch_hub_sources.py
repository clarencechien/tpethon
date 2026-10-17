"""Cache public research responses with hashes; a successful HTTP response may contain no data."""
import urllib.request,urllib.parse,json,hashlib,concurrent.futures
from pathlib import Path
from datetime import datetime,timezone
folder=Path(__file__).resolve().parents[1]/'local-data/hubs';folder.mkdir(exist_ok=True)
urls={
 'population_download':'https://www.ris.gov.tw/info-popudata/app/awFastDownload/view?type=ods&m4c=m0s8&d5c=11509',
 'population_portal':'https://www.ris.gov.tw/app/portal/346',
 'population_catalog_page':'https://www.ris.gov.tw/info-popudata/app/awFastDownload/toMain_panel',
 'population':'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP019/11509',
 'census':'https://census.dgbas.gov.tw/PHC2020/',
 'census_new':'https://www.stat.gov.tw/lp.asp?ctNode=6679&CtUnit=2444&BaseDSD=7&mp=4',
 'reward_metadata':'https://api.crossref.org/works/10.1016/j.tra.2011.03.003',
 'transport_stats':'https://stat.motc.gov.tw/mocdb/stmain.jsp?sys=100',
 'sumo_intermodal':'https://sumo.dlr.de/docs/IntermodalRouting.html',
 'sumo_parking':'https://sumo.dlr.de/docs/Simulation/Rerouter.html',
}
for key,q in [('park_ride','Parkhurst park and ride increase car traffic'),('synthesis','Beckman Baggerly McKay Creating synthetic baseline populations'),('incentives','Rewarding rush-hour avoidance A study of commuters travel behavior'),('gamification','gamification sustainable mobility systematic review')]:
 urls[key]='https://api.crossref.org/works?rows=3&query.bibliographic='+urllib.parse.quote(q)
def fetch(item):
 key,url=item
 try:
  target=folder/(key+'.raw');meta=folder/(key+'.evidence.json')
  if target.exists() and meta.exists():
   e=json.loads(meta.read_text())
   if hashlib.sha256(target.read_bytes()).hexdigest()!=e['sha256']:raise ValueError('Cache checksum mismatch')
   return e
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'tpethon-transport-research/1.0'}),timeout=35) as r:raw=r.read(10000001);status=r.status;resolved=r.url
  if len(raw)>10000000:raise ValueError('too large')
  (folder/(key+'.raw')).write_bytes(raw)
  e=dict(id=key,url=url,resolved_url=resolved,status=status,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),fetched_at=datetime.now(timezone.utc).isoformat())
  (folder/(key+'.evidence.json')).write_text(json.dumps(e));return e
 except Exception as e:return dict(id=key,url=url,error=str(e))
results=list(concurrent.futures.ThreadPoolExecutor(max_workers=4).map(fetch,urls.items()))
(folder/'audit.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
for r in results:print(json.dumps(r,ensure_ascii=False),flush=True)
