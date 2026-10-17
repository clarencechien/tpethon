"""Extract official household/population margins; never interpret residents as commuters."""
import json,re,zipfile,hashlib,xml.etree.ElementTree as E
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
NS={'t':'urn:oasis:names:tc:opendocument:xmlns:table:1.0'}
def extract(raw):
 import io
 doc=E.fromstring(zipfile.ZipFile(io.BytesIO(raw)).read('content.xml'))
 targets={'臺北市','新北市','基隆市','桃園市'};cities={};districts={};current=None;period=None
 for row in doc.findall('.//t:table-row',NS):
  vals=[]
  for cell in row.findall('t:table-cell',NS):
   vals.extend([''.join(cell.itertext()).strip()]*min(10,int(cell.get('{'+NS['t']+'}number-columns-repeated','1'))))
  for v in vals:
   if '115年09月底' in v:period='2026-09'
  if len(vals)<5:continue
  name=re.sub(r'\s','',vals[0])
  if name.endswith(('市','縣')):current=name
  if name in ['臺灣省','福建省']:current=None
  if name not in targets and not(name.endswith('區') and current in targets):continue
  try:hh,total,male,female=[int(v.replace(',','')) for v in vals[1:5]]
  except ValueError:continue
  if male+female!=total:raise ValueError('Population sex totals do not match')
  record=dict(households=hh,residents=total,male=male,female=female)
  if name in targets:
   if name in cities and cities[name]!=record:raise ValueError('Repeated city totals differ')
   cities[name]=record
  else:districts[(current,name)]=dict(city=current,district=name,**record)
 if period!='2026-09' or len(cities)!=4 or len(districts)!=61:raise ValueError('Unexpected geography or period')
 for city,c in cities.items():
  rows=[r for r in districts.values() if r['city']==city]
  for k in ['households','residents','male','female']:
   if sum(r[k] for r in rows)!=c[k]:raise ValueError('District margins do not add to city: '+city)
 return dict(period=period,cities=[dict(city=k,**v) for k,v in cities.items()],districts=list(districts.values()))
def main():
 folder=ROOT/'local-data/hubs';raw=(folder/'population_download.raw').read_bytes();e=json.loads((folder/'population_download.evidence.json').read_text())
 if hashlib.sha256(raw).hexdigest()!=e['sha256']:raise ValueError('Source hash mismatch')
 result=extract(raw);result.update(source=e,note='戶籍居民與戶數，不是就業人口或赴內湖通勤人次；未用來替代未知的私車OD比例。')
 (ROOT/'data/simulation/hub-population.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'cities':result['cities'],'districts':len(result['districts'])},ensure_ascii=False))
if __name__=='__main__':main()
