import {resultCards} from './ui.js';
import {brtDefaults,brtVersion,brtScenarios,conversionScan,transitionYears} from './brt_logic.js';
import {profileWeights} from './growth_logic.js';
const $=id=>document.getElementById(id),fmt=(v,d=0)=>v===null?'—':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:d});
const names={before:'同年不施工（假設）',construction:'施工・維持原服務',mixed:'施工＋加開一般公車',brt:'施工＋快速公車'},colors={before:'#87948e',construction:'#be662c',mixed:'#7655b3',brt:'#117d69'};
const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const fields=[
 ['people','起始年的私車使用者（人／尖峰）',0,100000,100],['existingBusPeople','起始年的既有公車乘客（人／尖峰）',0,50000,100],['conversion','主要道路的私車使用者，有幾成改搭（%）',0,100,1,100],['growth','需求年成長率（%）',-10,10,.1,100],['years','通車前模擬年數',1,15,1],['year','檢視開始施工後第幾年',0,14,1],['headway','加班車／BRT 班距（分）',.5,15,.5],['fleet','可出勤車輛（輛）',0,200,1],
 ['lanes','原有主通道單向車道數',1,6,1],['workLanes','施工占用車道數',0,5,1],['laneCapacity','每車道可用容量（PCU／時）',200,2500,50],['workFactor','施工剩餘容量係數（%）',30,100,1,100],['outerCapacity','外圍可用容量（PCU／時）',50,15000,50],['innerShare','私車原走主通道比例（%）',0,100,1,100],['occupancy','私車平均載客（人／車）',1,10,.1],['diversion','剩餘主通道私車改道（%）',0,80,1,100],['seats','公車每班額定載客（人）',10,250,1],['load','可用載客率（%）',10,100,1,100],['existingHeadway','既有公車班距（分）',1,30,.5],['reserve','額外備車比例（%）',0,100,1,100],['busPCU','混流公車小客車當量',1,5,.1],['distance','BRT 單程里程（公里）',1,30,.5],['cruiseSpeed','BRT 非停站行駛速度（km/h）',10,60,1],['stops','單程停站數',0,40,1],['dwellSeconds','BRT 每站停靠（秒）',5,180,1],['clearanceSeconds','單站清空間隔（秒）',5,120,1],['signals','單程路口數',0,50,1],['signalSeconds','優先號誌後每路口延誤（秒）',0,120,1],['recoveryMinutes','每循環折返恢復（分）',0,120,1],['restMinutes','每循環駕駛休息（分）',0,120,1],['mixedCycle','混流公車循環時間（分）',10,480,1],['mixedDwellSeconds','混流公車每站停靠（秒）',5,180,1]];
for(const [i,[key,label,min,max,step,scale=1]] of fields.entries()){
 const l=el('label',label),input=el('input','');Object.assign(input,{id:`b-${key}`,type:'number',min,max,step,value:brtDefaults[key]*scale,required:true});l.append(input);$(['people','conversion','year'].includes(key)?'basic':i<8?'service-inputs':'advanced').append(l);
}
let profiles=[],descriptor=null,profileError='實測型態載入中',report=null;
const time=m=>`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(Math.floor(m%60)).padStart(2,'0')}`;
function fillProfiles(){const select=$('profile'),previous=select.value,candidates=profiles.filter(p=>p.period===$('period').value);select.replaceChildren();for(const p of candidates){const o=el('option',`${p.name} ${p.direction} · ${p.sensor_id} · ${p.days.length} 天`);o.value=p.id;select.append(o);}const preferred=candidates.find(p=>p.id===previous)||candidates.find(p=>p.name==='堤頂大道'&&p.direction==='N')||candidates[0];if(preferred)select.value=preferred.id;else select.append(el('option',profileError||'此時段無完整型態'));}
function chart(id,labels,lines,unit){
 const max=Math.max(1,...lines.flatMap(l=>l.values.filter(Number.isFinite)))*1.08,x=i=>90+i/Math.max(1,labels.length-1)*485,y=v=>205-165*v/max;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 610 260');svg.setAttribute('role','img');svg.setAttribute('aria-label',unit);
 function node(tag,attrs,text){const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;}
 node('text',{x:90,y:20,'font-size':16,fill:'#466357'},unit);
 for(let i=0;i<4;i++){const v=max*i/3;node('line',{x1:90,x2:575,y1:y(v),y2:y(v),stroke:'#d9e3dd'});node('text',{x:83,y:y(v)+4,'text-anchor':'end','font-size':16},fmt(v));}
 for(const [i,label]of labels.entries())if(i%Math.ceil(labels.length/7)===0||i===labels.length-1)node('text',{x:x(i),y:233,'text-anchor':'middle','font-size':16},label);
 for(const line of lines){let pen=false;const path=line.values.map((v,i)=>{if(!Number.isFinite(v)){pen=false;return '';}const command=pen?'L':'M';pen=true;return `${command}${x(i)},${y(v)}`;}).join(' ');node('path',{d:path,stroke:colors[line.mode],fill:'none','stroke-width':2.5});if(labels.length<16)line.values.forEach((v,i)=>{if(Number.isFinite(v))node('circle',{cx:x(i),cy:y(v),r:3,fill:colors[line.mode]});});}
 $(id).replaceChildren(svg);
}
function replay(){if(!report)return;const t=Number($('replay').value),origin=report.period==='am'?360:960;$('clock').textContent=time(origin+t);$('tiles').replaceChildren();
 const maximum=Math.max(1,...report.scenarios.filter(r=>r.feasible).flatMap(r=>r.series.map(s=>s.innerQueue)));
 for(const r of report.scenarios){const tile=el('div','');tile.className='tile';tile.append(el('b',names[r.mode]));if(!r.feasible){tile.append(el('p','車道配置不可行'));}else{const p=r.series[Math.max(0,Math.min(r.series.length-1,Math.ceil(t*2)-1))];tile.style.backgroundColor=`hsl(${135-125*p.innerQueue/maximum} 65% 88%)`;tile.append(el('p',`道路 ${fmt(p.innerQueue)} PCU · 候車 ${fmt(p.passengerQueue)} 人`));} $('tiles').append(tile);}
}
function render(){
 try{
  const a={...brtDefaults};for(const [key,,min,max,step,scale=1]of fields){const input=$(`b-${key}`);if(!input.checkValidity())throw Error('請填入範圍內的完整數字');a[key]=Number(input.value)/scale;}
  const p=$('shape').value==='observed'?profiles.find(p=>p.id===$('profile').value):null;if($('shape').value==='observed'&&!p)throw Error(profileError||'缺少實測型態，請選人工示例或稍後重試');
  if(p)a.demandWeights=profileWeights(p);
  $('source').textContent=p?`套用 ${p.name} ${p.direction}，${p.days[0]}–${p.days.at(-1)} 共 ${p.days.length} 個完整參考工作日。每個抽樣權重延展 15 分鐘；原始統計區間未確認，只借用相對分布，不把 VD 相加成人次。觀測通過量也可能受壅塞限制。`:`人工單峰示例。${profileError||`已載入 ${profiles.length} 組實測型態，可在上方切換。`} 私車與公車共用需求分布是假設。`;
  $('profile').closest('label').hidden=$('shape').value!=='observed';
  const scenarios=brtScenarios(a),scan=conversionScan(a),annual=transitionYears(a);
  report={modelVersion:brtVersion,calibrated:false,period:$('period').value,assumptions:a,profile:p?{...p,descriptor}:null,scenarios,scan,annual,research:'data/simulation/brt-research.json'};
  $('error').textContent='';$('results').hidden=false;$('download').disabled=false;$('lanes').replaceChildren();$('comparison').replaceChildren();$('legend').replaceChildren();
  for(const r of scenarios){
   const c=el('article','');c.append(el('b',names[r.mode]));const lanes=el('div','');lanes.className='lane-row';
   if(r.feasible){for(const [n,label,cls]of [[r.generalLanes,'一般',''],[r.brtLanes,'BRT','brt'],[r.workLanes,'施工','work']])for(let i=0;i<n;i++){const cell=el('span',label);cell.className=`lane ${cls}`;lanes.append(cell);}}else lanes.append(el('p',r.reason));c.append(lanes);$('lanes').append(c);
   const tr=el('tr','');const vals=r.feasible?[names[r.mode],fmt(r.carTrips),fmt(r.passengers),(r.residualRoadPCU>1e-7?'≥':'')+fmt(r.queuePCUHours,1),fmt(r.meanInnerQueueMinutes,1),`${fmt(r.meanBoardedWaitMinutes,1)} / ${fmt(r.p95BoardedWaitMinutes,1)}`,`${fmt(r.unservedPassengers)} / ${fmt(r.residualRoadPCU)}`,`${r.requiredFleet} / ${r.procurementFleet}`]:[names[r.mode],'配置不可行','—','—','—','—','—','—'];for(const v of vals)tr.append(el('td',v));$('comparison').append(tr);
   const label=el('span',names[r.mode]);label.style.color=colors[r.mode];$('legend').append(label);
  }
  const b=scenarios[1],r=scenarios[3],complete=x=>x.feasible&&x.residualRoadPCU<1e-7&&x.unservedPassengers<1e-7;
  if(r.feasible)resultCards($('brt-cards'),[
   {title:'所有車輛合計排隊時間',unit:' 小時',note:'換算為小客車後加總；未疏解時只列下限。',series:[{label:'施工・維持原服務',value:b.queuePCUHours,lowerBound:b.residualRoadPCU>1e-7},{label:'施工・快速公車',value:r.queuePCUHours,lowerBound:r.residualRoadPCU>1e-7}]},
   {title:'已上車的人平均等多久？',unit:' 分鐘',note:`快速公車仍有 ${fmt(r.unservedPassengers)} 人未上車；不能只看已上車者的平均。`,series:[{label:'施工・維持原服務',value:b.meanBoardedWaitMinutes},{label:'施工・快速公車',value:r.meanBoardedWaitMinutes}]}
  ]);else $('brt-cards').replaceChildren();

  $('verdict').textContent=!r.feasible?r.reason:!complete(b)||!complete(r)?'有情境在追蹤窗內尚未清空，不能宣稱改善百分比。請一起檢查未上車乘客與殘餘道路排隊。':b.queuePCUHours<1e-7?'僅施工情境沒有道路排隊，無法計算減塞百分比。':`這組假設下，第 ${a.year} 年 BRT 道路總排隊較僅施工${r.queuePCUHours<=b.queuePCUHours?'減少':'增加'} ${fmt(Math.abs(r.queuePCUHours/b.queuePCUHours-1)*100,1)}%。這是 PCU·時的模型差異，不是內湖實測減塞率。`;
  $('capacity').textContent=r.feasible?`BRT 可用 ${r.seats} 人／班；有效班距 ${fmt(r.effectiveHeadway,1)} 分、單程 ${fmt(r.oneWayBRTMinutes,1)} 分、循環 ${fmt(r.cycleMinutes,1)} 分。長期可提供約 ${fmt(r.effectiveSeatsPerHour)} 人／時／方向；班表需 ${r.requiredFleet} 輛出勤、另備 ${r.reserveFleet} 輛。${a.fleet<r.requiredFleet?'可出勤車不足，模擬會等車輛返回才發車；零車隊則無法服務。':''}${r.stationSaturation>.4?'站點停靠占用超過 40%：ITDP 提醒可能產生公車排隊；此簡模未重現隨機站點回堵，須微觀模擬驗證。':''}`:'';
  const feasible=scenarios.filter(r=>r.feasible),length=Math.max(...feasible.map(r=>r.series.length)),indices=Array.from({length:Math.ceil(length/10)},(_,i)=>Math.min(length-1,i*10));
  const labels=indices.map(i=>time((report.period==='am'?360:960)+(i+1)/2));
  for(const [id,key,unit]of [['road-chart','innerQueue','道路排隊 PCU'],['wait-chart','passengerQueue','候車人數']])chart(id,labels,feasible.map(r=>({mode:r.mode,values:indices.map(i=>r.series[i]?.[key]??0)})),unit);
  $('replay').max=String(length/2);replay();$('scan').replaceChildren();
  for(const row of scan.rows){const cell=el('div',`${fmt(row.fraction*100)}% 轉乘`);cell.className=!complete(row)?'unknown':row.improves?'good':'bad';cell.append(el('div',!row.feasible?'配置不可行':!complete(row)?'未清空':`${fmt(row.queuePCUHours)} PCU·時`));$('scan').append(cell);}
  $('scan-note').textContent=scan.firstTestedImprovement===null?'這組測試未找到同時清空且道路總排隊較少的轉乘比例。':`本次 10% 格距中，首個符合條件的比例是 ${fmt(scan.firstTestedImprovement*100)}%；並非精確臨界點。候車、成本與可達性仍須另評估。`;
  for(const [id,key,unit]of [['annual-road','queuePCUHours','道路排隊 PCU·時'],['annual-wait','totalPassengerWaitHours','乘客候車 人·時']])chart(id,annual.map(r=>String(r.year)),['construction','mixed','brt'].map(mode=>({mode,values:annual.map(row=>{const r=row.results.find(r=>r.mode===mode);return complete(r)?r[key]:null;})})),unit);
  $('milestone').textContent=`X 軸為基期後年數 0–${a.years-1}；第 ${a.years} 年僅標示假設捷運接續，不預測通車後效果。所選檢視年份：第 ${a.year} 年。`;
 }catch(e){report=null;$('error').textContent=e.message;$('results').hidden=true;$('download').disabled=true;}
}
$('brt-form').onsubmit=e=>e.preventDefault();let timer;$('brt-form').oninput=e=>{if(e.target.id==='period')fillProfiles();report=null;$('results').hidden=true;$('download').disabled=true;clearTimeout(timer);timer=setTimeout(render,120);};$('replay').oninput=replay;
$('download').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=el('a','');a.href=url;a.download='neihu-brt-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();
(async()=>{try{const i=await fetch('./data/weeks/index.json',{signal:AbortSignal.timeout(20000)});if(!i.ok)throw Error('週索引讀取失敗');const index=await i.json(),entry=index.demand_profiles;if(entry?.file!=='profiles.json')throw Error('目前尚無完整實測型態');const r=await fetch('./data/weeks/profiles.json',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('實測型態讀取失敗');const raw=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');if(raw.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('實測版本不一致，請重新整理');const data=JSON.parse(new TextDecoder().decode(raw));if(data.as_of!==index.as_of||data.kind!=='single_direction_sampled_volume_shape'||!Array.isArray(data.profiles))throw Error('實測格式不符');for(const p of data.profiles)profileWeights(p);profiles=data.profiles;descriptor={...entry,as_of:data.as_of};profileError='';}catch(e){profileError=e.message;}fillProfiles();render();})();
