import {dataAvailability,scheduleMessage} from './availability.js';
import {brtDefaults,simulateBRT} from './brt_logic.js';
import {metroBaseline} from './growth_logic.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const fmt=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d}):'—',pct=v=>Number.isFinite(v)?fmt(v*100,1)+'%':'—';
const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未知';
let snapshot=null,manifest=null,replayIndex=null;
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
const parameterLabels={people:'基期私車使用者／尖峰人次',existingBusPeople:'基期既有公車乘客／尖峰人次',innerShare:'主通道私車需求比例',occupancy:'私車平均乘員／人',lanes:'原有單向車道',workLanes:'施工占道',laneCapacity:'每車道可用容量／PCU·時⁻¹',workFactor:'施工剩餘容量係數',outerCapacity:'外圍容量／PCU·時⁻¹',conversion:'主通道轉乘比例（中間示例）',diversion:'剩餘私車改道比例',seats:'公車額定載客／人',load:'可用載客率',headway:'加班車／BRT 班距／分',existingHeadway:'既有公車班距／分',fleet:'可出勤車隊／輛',reserve:'另加備車比例',busPCU:'混流公車小客車當量',distance:'BRT 單程里程／公里',cruiseSpeed:'非停站行駛速度／km/h',stops:'單程停站數',dwellSeconds:'BRT 停站／秒',clearanceSeconds:'站點清空間隔／秒',signals:'單程路口數',signalSeconds:'優先後每路口延誤／秒',recoveryMinutes:'每循環折返恢復／分',restMinutes:'每循環駕駛休息／分',mixedCycle:'混流循環時間／分',mixedDwellSeconds:'混流停站／秒',growth:'需求年成長率',years:'假設通車前模擬年數',year:'檢視基期後年數',peakMinutes:'尖峰長度／分'};
function renderExperiment(){
 const a={...brtDefaults,year:Number($('report-year').value)},baseline=simulateBRT(a,'construction');
 const rows=[['僅施工',baseline],['混流加班車 · 50% 轉乘',simulateBRT(a,'mixed')],...[.3,.5,.7].map(conversion=>[`BRT · ${conversion*100}% 轉乘`,simulateBRT({...a,conversion},'brt')])];
 $('assumption-summary').textContent=`基期私車使用者 ${fmt(a.people)} 人＋既有公車乘客 ${fmt(a.existingBusPeople)} 人／150 分鐘。原 3 車道、施工占 1 道；BRT 再占 1 道。年需求成長 ${pct(a.growth)}。`;
 $('assumption-details').replaceChildren();for(const [key,label]of Object.entries(parameterLabels))$('assumption-details').append(el('dt',label),el('dd',fmt(a[key],2)));
 $('growth-note').textContent=`第 ${a.year} 年：私車使用者 ${fmt(baseline.privatePeople)} 人，既有公車乘客 ${fmt(baseline.existingBusPeople)} 人；容量與班表不隨需求自動增加。轉乘率只作用於原走主要通道的私車使用者。`;
 const complete=r=>r.feasible&&r.residualRoadPCU<1e-7&&r.unservedPassengers<1e-7;
 function change(r){if(!complete(r)||!complete(baseline))return '未清空，不能比較';if(baseline.queuePCUHours<1e-7)return '基準無排隊';const percent=(r.queuePCUHours/baseline.queuePCUHours-1)*100;return `${percent>0?'增加':'減少'} ${fmt(Math.abs(percent),1)}%`;}
 $('outcome-rows').replaceChildren();for(const [label,r]of rows){const tr=el('tr','');for(const text of [label,(r.residualRoadPCU>1e-7?'≥':'')+fmt(r.queuePCUHours,1),r===baseline?'基準':change(r),fmt(r.meanBoardedWaitMinutes,1),`${fmt(r.unservedPassengers)} 人／${fmt(r.residualRoadPCU)} PCU`,`${r.requiredFleet}／${r.procurementFleet} 輛`])tr.append(el('td',text));$('outcome-rows').append(tr);}
 const middle=rows[3][1];$('outcome-takeaway').textContent=`50% 主通道轉乘的示例：道路總排隊${change(middle)}，班表需 ${middle.requiredFleet} 輛出勤、含備車 ${middle.procurementFleet} 輛。請對照 30% 與 70%：專用道需要足夠轉乘才能抵消一般車道減少；這不是內湖效果保證或採購數量。`;
}
$('report-year').onchange=renderExperiment;renderExperiment();
(async()=>{
 const outcomes=await Promise.allSettled([
  (async()=>{snapshot=await read('./data/dashboard.json');if(snapshot.schema_version!==1||!Array.isArray(snapshot.frames))throw Error('快照格式不符');renderHealth();})(),
  (async()=>{manifest=await read('./data/weeks/index.json');if(!Array.isArray(manifest.weeks)||!manifest.matched_weekdays?.am)throw Error('週摘要格式不符');historyHealth();const am=manifest.matched_weekdays.am,pm=manifest.matched_weekdays.pm;
   $('weekly-evidence').textContent=`資料以 ${manifest.as_of} 劃分兩週。晨峰配對 ${am.day_pairs.length} 組日期：上週 ${pct(am.previous?.slow_share)} → 本週 ${pct(am.current?.slow_share)} 低速觀測占比；晚峰配對 ${pm.day_pairs.length} 組：${pct(pm.previous?.slow_share)} → ${pct(pm.current?.slow_share)}。這是觀測差異，尚未控制天氣與事故。`;
   const entry=manifest.weeks.at(-1),week=await readVerified(entry);$('hotspot-period').textContent=`${week.start}–${week.end} 這一週 · 晨峰候選；至少三個參考工作日、各納入日八成時間格有效。`;
   $('hotspot-list').replaceChildren();for(const c of (week.hotspot_candidates?.am||[]).slice(0,3)){const card=el('article','');card.append(el('h3',`${c.road} ${c.direction||''}`),el('p',`${pct(c.hot_share)} 低速＋高占有率觀測 · ${c.observed_days} 天`));$('hotspot-list').append(card);}if(!$('hotspot-list').children.length)$('hotspot-list').append(el('p','目前沒有足夠觀測可列候選；不代表沒有瓶頸。'));
  })(),
  (async()=>{const m=await read('./data/metro.json'),mean=metroBaseline(m);$('metro-evidence').textContent=`${m.dates[0]}–${m.dates.at(-1)}，${m.weekdays} 個週一至週五，07–10 時進站且目的地為西湖／港墘的旅次，平均 ${fmt(mean)} 人次／日；未排國定假日。`;})(),
  (async()=>{replayIndex=await read('./data/history/index.json');historyHealth();})()
 ]);
 if(outcomes[0].status==='rejected'){snapshot=null;$('morning-coverage').textContent='未知';$('latest-time').textContent='讀取失敗';$('availability-reason').textContent='快照讀取失敗，無法核對今日資料；不以零車流替代。';$('schedule-health').textContent='排程紀錄未取得。';}
 if(outcomes[1].status==='rejected'){$('weekly-evidence').textContent=outcomes[1].reason.message+'，週比較暫不可用。';$('hotspot-list').replaceChildren(el('p','候選資料未取得，不能判定無瓶頸。'));}
 if(outcomes[2].status==='rejected')$('metro-evidence').textContent='捷運 OD 讀取失敗，平均人次未知。';
 if(outcomes[3].status==='rejected')$('history-updated').textContent+=' 地圖歷史索引讀取失敗。';
})();
setInterval(renderHealth,60000);
