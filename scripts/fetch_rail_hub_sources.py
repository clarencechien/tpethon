"""Read public route, timetable and OSM evidence; never publish credentials."""
import gzip,hashlib,json,sys,urllib.parse,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from scripts.backfill_tdx import token,download

def cache_public_routes(folder):
 url='https://tcgbusfs.blob.core.windows.net/blobbus/GetRoute.gz';dest=folder/'public-routes.raw';meta=folder/'public-routes.evidence.json'
 if dest.exists() and meta.exists():
  info=json.loads(meta.read_text());assert info['url']==url and hashlib.sha256(dest.read_bytes()).hexdigest()==info['sha256'];return info
 with urllib.request.urlopen(url,timeout=30) as response:body=response.read()
 json.loads(gzip.decompress(body) if body[:2]==b'\x1f\x8b' else body)
 info=dict(name='public-routes',url=url,bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),fetched_at=datetime.now(timezone.utc).isoformat(),status='downloaded')
 dest.write_bytes(body);meta.write_text(json.dumps(info));return info

def fetch():
 folder=ROOT/'local-data/rail-hub';folder.mkdir(parents=True,exist_ok=True)
 query='[out:json][timeout:25];way(25.048,121.576,25.071,121.587)["highway"];out tags geom;'
 sources={'osm-roads':'https://overpass-api.de/api/interpreter?'+urllib.parse.urlencode({'data':query}),
 'tra-stations':'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Station?%24format=JSON'}
 for route,label in [('15361','藍7'),('18044','藍7副'),('15691','內科通勤專車8'),('10846','286副')]:
  for kind in ['Schedule','S2STravelTime']:
   sources[kind.lower()+'-'+route]='https://tdx.transportdata.tw/api/basic/v2/Bus/'+kind+'/City/Taipei/'+(urllib.parse.quote(label) if kind=='Schedule' else route)+'?%24top=1000&%24format=JSON'
 bearer=None;auth_error=None;results=[cache_public_routes(folder)]
 try:bearer=token()
 except Exception as e:
  auth_error=dict(error_type=type(e).__name__,http_status=getattr(e,'code',None),stage='authentication')
  if isinstance(e,urllib.error.HTTPError):
   try:
    code=json.loads(e.read()).get('error');auth_error['oauth_error']=code if code in ['unauthorized_client','invalid_client','invalid_grant'] else 'other'
   except (ValueError,TypeError):pass
 for name,url in sources.items():
  dest=folder/(name+'.json');meta=folder/(name+'.evidence.json')
  try:
   if dest.exists() and meta.exists():
    info=json.loads(meta.read_text());assert info['url']==url and hashlib.sha256(dest.read_bytes()).hexdigest()==info['sha256'];results.append(info);print('Cached',name,flush=True);continue
   if 'tdx.transportdata.tw' in url:
    if auth_error:
     results.append(dict(name=name,url=url,status='unavailable',**auth_error));print('Unavailable',name,'authentication',flush=True);continue
    raw=folder/(name+'.response');info=download(url,bearer,raw);body=raw.read_bytes();body=gzip.decompress(body) if body[:2]==b'\x1f\x8b' else body
   else:
    with urllib.request.urlopen(url,timeout=40) as response:body=response.read()
    info={'url':url}
   data=json.loads(body.decode('utf-8-sig'));dest.write_bytes(body);info.update(name=name,sha256=hashlib.sha256(body).hexdigest(),bytes=len(body),fetched_at=datetime.now(timezone.utc).isoformat(),status='downloaded');meta.write_text(json.dumps(info));results.append(info);print('Saved',name,len(body),flush=True)
  except Exception as e:
   info=dict(name=name,url=url,status='unavailable',error_type=type(e).__name__,http_status=getattr(e,'code',None),checked_at=datetime.now(timezone.utc).isoformat());results.append(info);print('Unavailable',name,info['error_type'],info['http_status'],flush=True)
 (folder/'fetch-status.json').write_text(json.dumps(results))
if __name__=='__main__':fetch()
