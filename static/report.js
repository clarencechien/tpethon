import {dataAvailability,scheduleMessage} from './availability.js';
import {brtDefaults,simulateBRT} from './brt_logic.js';
import {metroBaseline} from './growth_logic.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const fmt=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d}):'—',pct=v=>Number.isFinite(v)?fmt(v*100,1)+'%':'—';
const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未知';
let snapshot=null,manifest=null,replayIndex=null,loading=false;
async function read(url){const r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`資料讀取失敗（${r.status}）`);return r.json();}
async function readVerified(entry){if(!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.file))throw Error('週檔名不符');const r=await fetch('./data/weeks/'+entry.file,{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('週資料讀取失敗');const raw=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');if(raw.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('週資料版本不一致');return JSON.parse(new TextDecoder().decode(raw));}
function renderHealth(){
 if(!snapshot)return;const a=dataAvailability(snapshot);
 $('morning-coverage').textContent=`${a.am.covered} / ${a.am.expected} 格`;$('morning-date').textContent=`${a.day} · ${a.phase==='not_started'?'尚未開始':a.phase==='in_progress'?'觀測中':'時段已結束'} · 每格 15 分鐘`;
 $('latest-time').textContent=a.source?date(a.source):'沒有來源時間';$('live-age').textContent=`${a.stale?'已過期／未知，不能當作即時':'來源在 10 分鐘內'}；網站建置 ${date(snapshot.generated_at)}`;
 $('availability-reason').textContent=a.reason;$('schedule-health').textContent=scheduleMessage(snapshot.collection_status);
 const trigger={push:'程式／資料推送',schedule:'定時排程',workflow_dispatch:'手動執行',workflow_run:'歷史更新完成',local_build:'本機建置'}[snapshot.collection_status?.publication_trigger]||'未記錄';
 $('publication-meta').textContent=`這次發布觸發：${trigger}。排程核對時間：${date(snapshot.collection_status?.checked_at)}。發布成功不代表晨峰資料完整。`;
}
function historyHealth(){
 $('historical-date').textContent=manifest?.latest_available_day||'週摘要未知';
 const latest=replayIndex?.days?.map(d=>d.day).sort().at(-1);
 $('history-updated').textContent=`摘要更新 ${date(manifest?.generated_at)}；地圖逐日回放到 ${latest||'未知'}。`;
}
const parameterLabels={people:'開始施工時的私車使用者／尖峰人次',existingBusPeople:'開始施工時的既有公車乘客／尖峰人次',innerShare:'私車使用者中，原走主要道路的比例',occupancy:'私車平均乘員／人',lanes:'原有單向車道',workLanes:'施工占道',laneCapacity:'每車道可用容量／PCU·時⁻¹',workFactor:'施工剩餘容量係數',outerCapacity:'外圍容量／PCU·時⁻¹',conversion:'主通道轉乘比例（中間示例）',diversion:'剩餘私車改道比例',seats:'公車額定載客／人',load:'可用載客率',headway:'加班車／BRT 班距／分',existingHeadway:'既有公車班距／分',fleet:'可出勤車隊／輛',reserve:'另加備車比例',busPCU:'混流公車小客車當量',distance:'BRT 單程里程／公里',cruiseSpeed:'非停站行駛速度／km/h',stops:'單程停站數',dwellSeconds:'BRT 停站／秒',clearanceSeconds:'站點清空間隔／秒',signals:'單程路口數',signalSeconds:'優先後每路口延誤／秒',recoveryMinutes:'每循環折返恢復／分',restMinutes:'每循環駕駛休息／分',mixedCycle:'混流循環時間／分',mixedDwellSeconds:'混流停站／秒',growth:'需求年成長率',years:'假設通車前模擬年數',year:'檢視開始施工後年數',peakMinutes:'尖峰長度／分'};
// HTML bars keep labels readable on narrow screens and do not rely on color alone.
function bar(label,value,max,unit='',kind=''){
 const row=el('div','');row.className='metric-row';
 const line=el('div','');line.className='metric-label';line.append(el('span',label),el('strong',Number.isFinite(value)?`${value>0&&value<.05?"< 0.1":fmt(value,1)}${unit}`:'資料未知'));
 const track=el('div','');track.className='metric-track';track.setAttribute('aria-hidden','true');
 const fill=el('div','');fill.className='metric-fill '+kind;fill.style.width=`${Number.isFinite(value)&&max>0?Math.max(0,Math.min(100,value/max*100)):0}%`;track.append(fill);row.append(line,track);return row;
}
const cleared=r=>r.feasible&&r.residualRoadPCU<1e-7&&r.unservedPassengers<1e-7;
function renderCitizenComparison(a,baseline){
 const chosen={...a,conversion:Number($('report-conversion').value)/100},before=simulateBRT(chosen,'before'),action=simulateBRT(chosen,'brt');
 $('conversion-value').textContent=pct(chosen.conversion);
 const complete=cleared(baseline)&&cleared(action),delta=baseline.queuePCUHours>1e-7?(1-action.queuePCUHours/baseline.queuePCUHours)*100:null;
 $('comparison-verdict').textContent=complete&&delta!==null?`在這組假設下，快速公車讓車輛合計排隊時間${delta>=0?'減少':'增加'} ${fmt(Math.abs(delta),1)}%。班表需 ${action.requiredFleet} 輛出勤，另備 ${action.reserveFleet} 輛，共 ${action.procurementFleet} 輛。${delta<0?'改搭的人不足以抵消一般車道減少，這個方案反而更塞。':'這是模型中的總排隊變化，不是每個人的通勤省時比例。'}`:'這組條件還不能判定改善：道路或乘客尚未全部疏解，請先增加運能或調整方案。';
 const specs=[['車輛合計排隊時間','queuePCUHours',' 小時','換算成小客車後加總；越少越好。'],['已上車的人，平均等公車多久？','meanBoardedWaitMinutes',' 分鐘','只含已上車者；尚未上車的人另外列出。'],['私車出行有多少？','carTrips',' 輛次','每輛平均 1.3 人；同一輛車多次出行會重複計。'],['班表需要多少公車？','procurementFleet',' 輛','包含備用車；這是示例需求，不是採購建議。']];
 const chart=$('comparison-charts');chart.replaceChildren();
 for(const [title,key,unit,note]of specs){const card=el('article','');card.append(el('h3',title),el('p',note));const max=Math.max(before[key],baseline[key],action[key],1);card.append(bar('同年不施工（假設）',before[key],max,unit,'before'),bar('施工・維持原服務',baseline[key],max,unit,'base'),bar('施工・快速公車',action[key],max,unit));chart.append(card);}
 $('people-accounting').textContent=`原本走主要道路的私車使用者有 ${fmt(Math.round(action.privatePeople*a.innerShare))} 人；你設定其中 ${pct(chosen.conversion)} 改搭，也就是 ${fmt(action.shiftedPeople)} 人。加上原有公車乘客 ${fmt(action.existingBusPeople)} 人，公車需承接 ${fmt(action.passengers)} 人。兩個施工方案都保留全部 ${fmt(action.totalPeople)} 人的交通需求。`;
 $('service-accounting').textContent=`快速公車每 ${a.headway} 分鐘一班、每班可載 ${Math.floor(a.seats*a.load)} 人；假設有 ${a.fleet} 輛可出勤，來回與停靠、折返、休息合計 ${fmt(action.cycleMinutes,1)} 分鐘。追蹤結束：維持原服務有 ${fmt(baseline.unservedPassengers)} 人未上車、${fmt(baseline.residualRoadPCU,1)} 輛換算小客車未疏解；快速公車有 ${fmt(action.unservedPassengers)} 人未上車、${fmt(action.residualRoadPCU,1)} 輛未疏解。未疏解時，圖中累積排隊時間只是下限。`;
 const annual=Array.from({length:5},(_,year)=>({year,base:simulateBRT({...chosen,year},'construction'),action:simulateBRT({...chosen,year},'brt')}));
 const maximum=Math.max(1,...annual.flatMap(v=>[v.base.queuePCUHours,v.action.queuePCUHours]));$('annual-chart').replaceChildren();
 for(const r of annual){const card=el('article','');card.append(el('h4',r.year===0?'開始施工這一年':`施工後第 ${r.year} 年`),bar('維持原服務',r.base.queuePCUHours,maximum,' 小時','base'),bar('快速公車',r.action.queuePCUHours,maximum,' 小時'));const note=el('p',cleared(r.base)&&cleared(r.action)?'全部車輛與乘客均已疏解':'尚未全部疏解，不能據此判定改善');note.className='fine';card.append(note);$('annual-chart').append(card);}
}
function renderExperiment(){
 const a={...brtDefaults,year:Number($('report-year').value)},baseline=simulateBRT(a,'construction');
 const rows=[['施工・維持原服務',baseline],['加開一般公車・50% 改搭',simulateBRT(a,'mixed')],...[.3,.5,.7].map(conversion=>[`快速公車・${conversion*100}% 改搭`,simulateBRT({...a,conversion},'brt')])];
 $('assumption-summary').textContent=`開始施工時的私車使用者 ${fmt(a.people)} 人＋既有公車乘客 ${fmt(a.existingBusPeople)} 人／150 分鐘。原 3 車道、施工占 1 道；BRT 再占 1 道。年需求成長 ${pct(a.growth)}。`;
 $('assumption-details').replaceChildren();for(const [key,label]of Object.entries(parameterLabels))$('assumption-details').append(el('dt',label),el('dd',['innerShare','workFactor','conversion','diversion','load','reserve','growth'].includes(key)?pct(a[key]):fmt(a[key],2)));
 $('growth-note').textContent=`第 ${a.year} 年：私車使用者 ${fmt(baseline.privatePeople)} 人，既有公車乘客 ${fmt(baseline.existingBusPeople)} 人；容量與班表不隨需求自動增加。改搭比例只計算原走主要道路的私車使用者。`;
 const complete=r=>r.feasible&&r.residualRoadPCU<1e-7&&r.unservedPassengers<1e-7;
 function change(r){if(!complete(r)||!complete(baseline))return '未清空，不能比較';if(baseline.queuePCUHours<1e-7)return '基準無排隊';const percent=(r.queuePCUHours/baseline.queuePCUHours-1)*100;return `${percent>0?'增加':'減少'} ${fmt(Math.abs(percent),1)}%`;}
 $('outcome-rows').replaceChildren();for(const [label,r]of rows){const tr=el('tr','');for(const text of [label,(r.residualRoadPCU>1e-7?'≥':'')+fmt(r.queuePCUHours,1),r===baseline?'基準':change(r),fmt(r.meanBoardedWaitMinutes,1),`${fmt(r.unservedPassengers)} 人／${fmt(r.residualRoadPCU)} PCU`,`${r.requiredFleet}／${r.procurementFleet} 輛`])tr.append(el('td',text));$('outcome-rows').append(tr);}
 renderCitizenComparison(a,baseline);
 const middle=rows[3][1];$('outcome-takeaway').textContent=`50% 主通道轉乘的示例：道路總排隊${change(middle)}，班表需 ${middle.requiredFleet} 輛出勤、含備車 ${middle.procurementFleet} 輛。請對照 30% 與 70%：專用道需要足夠轉乘才能抵消一般車道減少；這不是內湖效果保證或採購數量。`;
}
$('report-year').onchange=renderExperiment;$('report-conversion').oninput=renderExperiment;renderExperiment();
async function loadReport(){
 if(loading)return;loading=true;$('reload-report').disabled=true;
 const outcomes=await Promise.allSettled([
  (async()=>{snapshot=await read('./data/dashboard.json');if(snapshot.schema_version!==1||!Array.isArray(snapshot.frames))throw Error('快照格式不符');renderHealth();})(),
  (async()=>{manifest=await read('./data/weeks/index.json');if(!Array.isArray(manifest.weeks)||!manifest.matched_weekdays?.am)throw Error('週摘要格式不符');historyHealth();const am=manifest.matched_weekdays.am,pm=manifest.matched_weekdays.pm;
   $('weekly-chart').replaceChildren();for(const [label,v]of [['上班 07:00–09:30',am],['下班 17:00–19:30',pm]]){const block=el('div','');block.append(el('h4',label),bar('上週',Number.isFinite(v.previous?.slow_share)?v.previous.slow_share*100:NaN,100,'%','base'),bar('本週',Number.isFinite(v.current?.slow_share)?v.current.slow_share*100:NaN,100,'%'));$('weekly-chart').append(block);}const scale=el('p','長條全長為 100%：每 100 次有效偵測，有幾次車速低於 20 km/h。');scale.className='scale-note';$('weekly-chart').append(scale);
   $('weekly-evidence').textContent=`截至 ${manifest.latest_available_day}，上班配對 ${am.day_pairs.length} 組日期、下班配對 ${pm.day_pairs.length} 組日期。這是兩週觀測的差別，還沒有排除天氣與事故的影響。`;
   const entry=manifest.weeks.at(-1),week=await readVerified(entry);$('hotspot-period').textContent=`${week.start}–${week.end} 這一週 · 上班時段；至少觀測三個週一至週五，且各日有八成以上的時段有資料。`;
   $('hotspot-list').replaceChildren();for(const c of (week.hotspot_candidates?.am||[]).slice(0,3)){const card=el('article','');const direction={N:'往北',NE:'往東北',E:'往東',SE:'往東南',S:'往南',SW:'往西南',W:'往西',NW:'往西北'}[c.direction]||c.direction||'';card.append(el('h3',`${c.road} ${direction}`),bar('車速慢且車輛密集',c.hot_share*100,100,'%'),el('p',`觀測 ${c.observed_days} 天；長條全長為 100%。`));$('hotspot-list').append(card);}if(!$('hotspot-list').children.length)$('hotspot-list').append(el('p','目前沒有足夠觀測可列候選；不代表沒有瓶頸。'));
  })(),
  (async()=>{const m=await read('./data/metro.json'),mean=metroBaseline(m);$('metro-total').textContent=fmt(mean);$('metro-evidence').textContent=`${m.dates[0]}–${m.dates.at(-1)}，${m.weekdays} 個週一至週五，07–10 時進站、前往西湖或港墘，平均 ${fmt(mean)} 人次／日。這是進站時間，未必是抵達時間；尚未排除國定假日。`;})(),
  (async()=>{replayIndex=await read('./data/history/index.json');historyHealth();})()
 ]);
 if(outcomes[0].status==='rejected'){snapshot=null;$('morning-coverage').textContent='未知';$('latest-time').textContent='讀取失敗';$('live-age').textContent='本次未取得來源時間，請重新讀取';$('morning-date').textContent='';$('publication-meta').textContent='本次未取得發布資訊';$('availability-reason').textContent='快照讀取失敗，無法核對今日資料；不以零車流替代。';$('schedule-health').textContent='排程紀錄未取得。';}
 if(outcomes[1].status==='rejected'){$('weekly-chart').replaceChildren();$('weekly-evidence').textContent=outcomes[1].reason.message+'，週比較暫不可用。';$('hotspot-list').replaceChildren(el('p','候選資料未取得，不能判定無瓶頸。'));}
 if(outcomes[2].status==='rejected'){$('metro-total').textContent='未知';$('metro-evidence').textContent='捷運乘車紀錄讀取失敗，平均人次未知。';}
 if(outcomes[3].status==='rejected')$('history-updated').textContent+=' 地圖歷史索引讀取失敗。';
 loading=false;$('reload-report').disabled=false;
}
$('reload-report').onclick=loadReport;loadReport();
setInterval(renderHealth,60000);
setInterval(()=>{if(!document.hidden)loadReport();},300000);
