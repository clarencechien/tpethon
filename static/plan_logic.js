// Capacity accounting, not a traffic speed/route-choice prediction.
export function busPlan({people,shift,capacity,load,peakMinutes,cycleMinutes,carOccupancy,reserve}){
 const values=[people,shift,capacity,load,peakMinutes,cycleMinutes,carOccupancy,reserve];
 if(values.some(v=>!Number.isFinite(v))||people<0||shift<0||shift>1||capacity<=0||load<=0||load>1||peakMinutes<=0||cycleMinutes<=0||carOccupancy<1||reserve<0||reserve>1)throw Error('請輸入有效的需求、容量與時間範圍');
 const passengers=Math.ceil(people*shift),effectiveCapacity=Math.floor(capacity*load);
 if(effectiveCapacity<1)throw Error('有效載客量至少需 1 人');
 const departures=Math.ceil(passengers/effectiveCapacity);
 const departuresPerHour=Math.ceil(departures/(peakMinutes/60));
 const operatingFleet=Math.ceil(departuresPerHour*cycleMinutes/60);
 const reserveFleet=Math.ceil(operatingFleet*reserve);
 return {passengers,effectiveCapacity,minimumDepartures:departures,departuresPerHour,
   operatingFleet,reserveFleet,totalFleet:operatingFleet+reserveFleet,
   headwayMinutes:departuresPerHour?60/departuresPerHour:null,
   hypotheticalRemovedCarTrips:passengers/carOccupancy,
   deliveredCapacity:departuresPerHour*(peakMinutes/60)*effectiveCapacity,
   trafficDelayChange:null,networkValidated:false};
}
