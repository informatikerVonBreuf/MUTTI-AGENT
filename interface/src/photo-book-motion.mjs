// Source-image coordinates keep the mesh registered to the photographed book.
export const READER_IMAGE={width:1122,height:1402};
export const BOOK_CORNERS={spineFar:{x:625,y:1035},spineNear:{x:454,y:1173},rightFar:{x:994,y:1094},rightNear:{x:944,y:1281},leftFar:{x:213,y:1009},leftNear:{x:107,y:1093}};
const clamp=value=>Math.max(0,Math.min(1,value));
const lerp=(a,b,t)=>a+(b-a)*t;
export function fitReaderImage(width,height,positionX=.64,positionY=.76){
  if(width<=0||height<=0)return {width:0,height:0,left:0,top:0};
  const scale=Math.max(width/READER_IMAGE.width,height/READER_IMAGE.height);
  const imageWidth=READER_IMAGE.width*scale,imageHeight=READER_IMAGE.height*scale;
  return {width:imageWidth,height:imageHeight,left:(width-imageWidth)*positionX,top:(height-imageHeight)*positionY};
}
export function photoPagePose(seconds){
  const phase=((seconds%6.4)+6.4)%6.4/6.4;
  const raw=clamp((phase-.12)/.72),turn=raw*raw*(3-2*raw);
  const opacity=Math.min(clamp((phase-.07)/.05),clamp((.92-phase)/.08));
  return {turn,opacity};
}
export function photoPagePoint(u,v,turn){
  const c=BOOK_CORNERS,t=clamp(turn),angle=t*Math.PI,cos=Math.cos(angle),sin=Math.sin(angle);
  const sx=lerp(c.spineFar.x,c.spineNear.x,v),sy=lerp(c.spineFar.y,c.spineNear.y,v);
  const edge=cos>=0?{x:lerp(c.rightFar.x,c.rightNear.x,v),y:lerp(c.rightFar.y,c.rightNear.y,v)}:{x:lerp(c.leftFar.x,c.leftNear.x,v),y:lerp(c.leftFar.y,c.leftNear.y,v)};
  const curl=Math.sin(Math.PI*u)*sin*(22+v*13);
  const x=sx+(edge.x-sx)*u*Math.abs(cos);
  const imageY=sy+(edge.y-sy)*u*Math.abs(cos)-sin*u*(235-v*30)-curl;
  return {x,y:READER_IMAGE.height-imageY,z:sin*u*235+curl*1.3};
}
