/** A four-node classroom network, not a Neihu road model.
 * Static nonatomic user equilibrium: no driver improves by changing route alone.
 * Flow q is vehicles/hour; travel time is minutes. Variable edges cost flow/100;
 * the other two edges cost 45, the connector costs 0. No signals or spillback.
 */
export function networkExample(q,mode='forward'){
 if(!Number.isFinite(q)||q<0||q>20000||!['forward','closed','reverse'].includes(mode))throw new RangeError('Invalid classroom demand or connector direction');
 let upper=q/2,lower=q/2,connector=0;
 if(mode==='forward'){
  if(q<=4500){upper=0;lower=0;connector=q;}
  else if(q<9000){upper=q-4500;lower=q-4500;connector=9000-q;}
 }else if(mode==='reverse'&&q>9000){upper=4500;lower=4500;connector=q-9000;}
 const sa=upper+(mode==='forward'?connector:0),bt=lower+(mode==='forward'?connector:0);
 const sb=lower+(mode==='reverse'?connector:0),at=upper+(mode==='reverse'?connector:0);
 const costs={upper:sa/100+45,lower:45+bt/100,connector:mode==='closed'?null:mode==='forward'?sa/100+bt/100:90};
 const minutes=q?(upper*costs.upper+lower*costs.lower+connector*(costs.connector??0))/q:0;
 return {q,mode,calibrated:false,minutes,vehicleHours:q*minutes/60,paths:{upper,lower,connector},edges:{sa,sb,at,bt,connector},costs};
}
