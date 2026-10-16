import {taipeiParts,frameTime,summarizePeriod} from './logic.js';
export function dataAvailability(data,now=Date.now()){
 const day=taipeiParts(new Date(now).toISOString()).day,minute=taipeiParts(new Date(now).toISOString()).minute;
 const frames=(data?.frames||[]).filter(f=>Date.parse(frameTime(f))<=now+120000),am=summarizePeriod(frames,day,'am');
 const stamps=frames.map(frameTime).filter(t=>taipeiParts(t)?.day===day).sort((a,b)=>Date.parse(a)-Date.parse(b));
 const first=stamps[0]||null,source=data?.current?.road?.timestamp||null,age=source?(now-Date.parse(source))/60000:null;
 const phase=minute<420?'not_started':minute<570?'in_progress':'ended';
 let reason=phase==='not_started'?'今日晨峰尚未開始。':am.covered===0?'今日晨峰沒有可用觀測，不能判斷是否塞車。':`今日晨峰 ${am.covered}/${am.expected} 個時間格有有效觀測；未觀測時段不補值。`;
 if(phase!=='not_started'&&am.covered===0&&first&&taipeiParts(first).minute>=570)reason+=`已保存的今日首筆來源時間為 ${first.slice(11,16)}，在晨峰結束後。`;
 if(phase!=='not_started'&&am.coverage<.8)reason+='TDX 歷史 API 不提供當日回補；須等隔日來源可用後，由 11:23／23:23 排程嘗試回補。';
 return {day,phase,first,source,ageMinutes:age,stale:age===null||!Number.isFinite(age)||age>10||age< -2,am:{covered:am.covered,expected:am.expected,coverage:am.coverage,slowShare:am.slowShare},reason};
}
export function scheduleMessage(status){
 if(!status)return '排程執行狀態尚未取得，不能視為已成功擷取。';
 const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
 const labels={'pages.yml':'即時快照','weekly-data.yml':'歷史回補'};
 return Object.entries(labels).map(([key,label])=>{
  const r=status.workflows?.[key];if(!r||r.status==='unknown')return `${label}：無法核對排程紀錄`;
  if(r.status==='no_scheduled_runs')return `${label}：尚查無定時觸發紀錄`;
  const latest=r.latest,success=r.last_success_in_recent_runs;
  return `${label}：最近定時觸發 ${date(latest?.created_at)}（${({success:'成功',failure:'失敗',cancelled:'已取消',timed_out:'逾時'})[latest?.conclusion]||'執行中／排隊中'}）；近 30 次紀錄內最近成功 ${date(success?.created_at)}`;
 }).join('。')+'。';
}
