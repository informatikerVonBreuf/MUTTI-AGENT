const clamp=value=>Math.min(1,Math.max(0,value));
export function smoothStep(value){const t=clamp(value);return t*t*(3-2*t);}
export function pagePoint(u,v,turn){
  const angle=clamp(turn)*Math.PI,width=.99,depth=1.1;
  return {x:Math.cos(angle)*width*u,y:1.73+Math.sin(angle)*width*u+.08*Math.sin(Math.PI*u)*Math.sin(angle),z:.55+(v-.5)*depth};
}
export function readingPose(seconds){
  const phase=((seconds%9)+9)%9/9,turn=smoothStep((phase-.57)/.28),turning=phase>=.57&&phase<=.85;
  const edge=pagePoint(.92,.84,turn);
  return {turn,turning,headYaw:Math.sin(seconds*.48)*.11,headPitch:.19+Math.sin(seconds*.8)*.035,breath:Math.sin(seconds*1.3)*.012,
    leftHand:{x:-.57+Math.sin(seconds*.85)*.13,y:1.81,z:.95},
    rightHand:turning?{x:edge.x,y:edge.y+.065,z:edge.z+.025}:{x:.87,y:1.81,z:.97}};
}
