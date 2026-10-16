// Static, versioned JSON files committed to GitHub and served alongside this app.
export function decodeArchive(archive) {
  if(archive.schema_version!==1||archive.sampling!=='exact_quarter_hour_snapshot'||!Array.isArray(archive.sensors)||!Array.isArray(archive.frames)||JSON.stringify(archive.columns)!==JSON.stringify(['sensor','speed','occupancy','volume','active_lanes','status']))throw Error('歷史檔格式不符');
  const ids=new Set();
  for(const s of archive.sensors){if(!s.id||ids.has(s.id)||!Number.isFinite(s.lat)||!Number.isFinite(s.lon))throw Error('歷史測站格式不符');ids.add(s.id);}
  return archive.frames.map(([timestamp,values])=>{
    const time=new Date(timestamp),local=new Date(time.getTime()+8*3600000);
    if(!Number.isFinite(time.getTime())||local.toISOString().slice(0,10)!==archive.day||local.getUTCMinutes()%15||local.getUTCSeconds())throw Error('歷史觀測日期或抽樣時間不符');
    const seen=new Set();
    const rows=values.map(value=>{
      const [sensor,speed,occupancy,volume,active_lanes,status]=value;
      if(value.length!==6||!Number.isInteger(sensor)||!archive.sensors[sensor]||seen.has(sensor))throw Error('歷史觀測測站索引不符');seen.add(sensor);
      return {...archive.sensors[sensor],speed,occupancy,volume,active_lanes,status,timestamp};
    });
    return {captured_at:timestamp,road:{timestamp,rows,source:'TDX Taipei VD historical',archive_day:archive.day}};
  });
}
export function combineFrames(recent,archives){
  const frames=new Map();
  for(const f of [...recent,...archives])frames.set(f.road.timestamp||f.captured_at,f);
  return [...frames.values()].sort((a,b)=>Date.parse(a.road.timestamp||a.captured_at)-Date.parse(b.road.timestamp||b.captured_at));
}
