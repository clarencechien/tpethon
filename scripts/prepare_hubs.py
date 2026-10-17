"""Publish source-audited parking anchors and explicitly synthetic hub experiment inputs."""
import json,hashlib
from pathlib import Path
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[1]
def main():
 folder=ROOT/'local-data/hubs';parking_raw=(ROOT/'local-data/sites/parking.raw').read_bytes();parking=json.loads(parking_raw)['data'];rows={r['id']:r for r in parking['park']}
 transform=Transformer.from_crs('EPSG:3826','EPSG:4326',always_xy=True)
 specs=[('flower','花博／圓山',1,'TPE0007','minquan'),('airport','松山機場',1,'TPE0624','minquan'),('songshan','松山車站',2,'TPE0851','chengmei'),('nangang','南港車站',2,'TPE0959','chenggong'),('cityhall','市政府',2,'TPE0766','maishuai'),('taipei','台北車站',2,'TPE0446','minquan')]
 hubs=[]
 for key,name,tier,pid,gate in specs:
  r=rows[pid];coord=list(transform.transform(float(r['tw97x']),float(r['tw97y'])))
  hubs.append(dict(id=key,name=name,tier=tier,parking_id=pid,parking_name=r['name'],coordinates=coord,total_car_spaces=r['totalcar'],total_bus_spaces=r['totalbus'],address=r['address'],fees=r['payex'],hours=r['serviceTime'],allocated_spaces=None,bus_stop_approved=False,gate=gate,coordinate_basis='官方停車場資料點；不是入口、轉乘步道或已核准BRT站位'))
 gates=[('minquan','民權大橋',121.569,25.067,500),('huandong','環東大道',121.614,25.061,450),('chengmei','成美橋',121.579,25.057,350),('chenggong','成功橋',121.590,25.060,400),('nanhu','南湖大橋',121.615,25.067,300),('maishuai','麥帥橋群',121.571,25.053,300)]
 origins=[('taipei_west','台北西側',121.51,25.065,'minquan'),('taipei_south','台北南側',121.54,25.020,'maishuai'),('newtaipei_west','新北西側／板橋',121.464,25.014,'minquan'),('newtaipei_south','新北南側',121.52,24.98,'chengmei'),('xizhi','汐止',121.663,25.068,'nanhu'),('keelung','基隆',121.739,25.132,'huandong'),('taoyuan','桃園',121.314,24.989,'chenggong'),('neihu_east','東湖／內湖東側',121.611,25.083,'nanhu')]
 nodes=[dict(id=k,name=n,coordinates=[x,y],role='gateway',capacity_vph_assumption=c,verified_capacity=False) for k,n,x,y,c in gates]
 for k,n,x,y,t in [('banqiao','板橋車站',121.464,25.014,2),('keelung_station','基隆車站',121.739,25.132,3),('xizhi_station','汐止車站',121.663,25.068,3),('taoyuan_station','桃園車站',121.314,24.989,3),('zhongli','中壢車站',121.225,24.953,3),('tamsui','淡水捷運站',121.446,25.167,3),('xindian','新店捷運站',121.537,24.958,3)]:
  nodes.append(dict(id=k,name=n,coordinates=[x,y],role='regional_rail',tier=t,modeled_as_individual_hub=False,note='概略位置，作鐵路／公路集散候選；尚無個別停車或增班配額，不宣稱新增BRT直達線'))
 sources=[]
 for p in sorted(folder.glob('*.evidence.json')):
  e=json.loads(p.read_text());raw=p.with_name(p.name.replace('.evidence.json','.raw')).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=e['sha256']:raise ValueError('Invalid research cache')
  sources.append(e)
 papers=[]
 for name in ['park_ride','synthesis','gamification']:
  j=json.loads((folder/(name+'.raw')).read_text())
  for r in j['message']['items'][:(2 if name=='park_ride' else 1)]:papers.append(dict(title=r['title'][0],doi=r['DOI'],year=r.get('published',{}).get('date-parts'),read_status='僅核對Crossref書目；未讀全文，不採效果係數'))
 if (folder/'reward_metadata.raw').exists():
  j=json.loads((folder/'reward_metadata.raw').read_text()).get('message',{})
  if 'DOI' in j:papers.append(dict(title=j['title'][0],doi=j['DOI'],read_status='僅核對書目，不採獎勵反應係數'))
 out=dict(schema_version=1,checked_on='2026-10-17',calibrated=False,parking_source_time=parking['UPDATETIME'],parking_source_url='https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json',parking_sha256=hashlib.sha256(parking_raw).hexdigest(),hubs=hubs,nodes=nodes,
 origins=[dict(id=k,name=n,coordinates=[x,y],gate=g,weight=1/len(origins)) for k,n,x,y,g in origins],destination=[121.579,25.074],sources=sources,papers=papers,
 population_margins=dict(path='data/simulation/hub-population.json',sha256=hashlib.sha256((ROOT/'data/simulation/hub-population.json').read_bytes()).hexdigest(),used_as_commuter_weights=False),
 population_note='8個來源區等權重是實驗假設；不代表北北基桃通勤比例。只生成原本單人開車的假想旅次，不把捷運人次轉成汽車需求。',
 geometry_note='非停車場節點為概略規劃位置；不作導航、管制邊界或轉向認證。模型距離是直線×1.4的代理，不是道路路由。',
 evidence_status={'parking':'官方總位及資料點已取得，本案可保留配額未知','population':'已取得2026-09北北基桃61區戶籍人口及戶數；尚缺通勤OD，不以居民比例代替赴內湖私車比例','metro':'2026-09西湖／港墘OD作既有捷運需求背景，不作私車來源比例','rail':'第三層僅測假設新增接駁名額；未核對台鐵／捷運剩餘容量','sumo':'已讀官方轉乘及滿場改道方法；本輪為自製簡化模型，未跑SUMO'})
 (ROOT/'data/simulation/hub-inputs.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print('Prepared',len(hubs),'parking anchors and',len(nodes),'gateway/regional nodes')
if __name__=='__main__':main()
