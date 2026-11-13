import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {pagePoint,readingPose} from './reading-motion.mjs';
const palette={paper:0xf0e6cf,skin:0xb97d57,hair:0x25392f,jacket:0xa45d43,shirt:0xe2d5af,wood:0xa68c61,cover:0x244f43,ink:0x55705c};
export function createReadingWorld({texture=null,variant='cover'}={}){
  const scene=new THREE.Scene(),world=new THREE.Group();scene.add(world);
  const materials=new Map();
  const material=(color,extra={})=>{const key=String(color)+JSON.stringify(extra);if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.9,metalness:0,...extra}));return materials.get(key);};
  const skin=material(palette.skin),hair=material(palette.hair),coat=material(variant==='themes'?0x825966:palette.jacket),shirt=material(palette.shirt),wood=material(palette.wood),cover=material(palette.cover),paper=material(palette.paper),gold=material(0xc4b67b,{metalness:.3,roughness:.6});
  const mesh=(geometry,mat,parent=world)=>{const object=new THREE.Mesh(geometry,mat);object.castShadow=true;object.receiveShadow=true;parent.add(object);return object;};
  function box(w,h,d,mat,x,y,z,r=.06,parent=world){const m=mesh(new RoundedBoxGeometry(w,h,d,2,r),mat,parent);m.position.set(x,y,z);return m;}
  function ball(x,y,z,sx,sy,sz,mat,parent=world){const m=mesh(new THREE.SphereGeometry(1,24,16),mat,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m;}
  const up=new THREE.Vector3(0,1,0),from=new THREE.Vector3(),to=new THREE.Vector3(),direction=new THREE.Vector3();
  function placeLimb(object,a,b){from.set(a.x,a.y,a.z);to.set(b.x,b.y,b.z);direction.subVectors(to,from);object.position.copy(from).add(to).multiplyScalar(.5);object.scale.y=direction.length();object.quaternion.setFromUnitVectors(up,direction.normalize());}
  function limb(a,b,r,mat){const object=mesh(new THREE.CylinderGeometry(r,r,1,18),mat);placeLimb(object,a,b);return object;}
  // Chair and legs are a quiet, sculptural silhouette below the reading desk.
  box(1,.13,.75,cover,0,.89,-.52,.09);box(.96,1.15,.14,cover,0,1.42,-1,.09);
  for(const x of [-.37,.37])for(const z of [-.78,-.25])limb({x,y:.83,z},{x:x*1.15,y:.04,z:z-.07},.045,wood);
  for(const side of [-1,1]){const x=side*.22;limb({x,y:1.02,z:-.47},{x:side*.28,y:.79,z:.18},.17,hair);ball(side*.28,.79,.18,.17,.17,.17,hair);limb({x:side*.28,y:.79,z:.18},{x:side*.30,y:.14,z:.25},.125,hair);ball(side*.30,.12,.39,.17,.10,.29,hair);}
  box(3.35,.15,1.75,wood,0,1.48,.45,.09);
  for(const x of [-1.39,1.39])for(const z of [-.12,1.03])limb({x,y:1.43,z},{x:x*1.04,y:.02,z:z+.08},.055,cover);
  // A clothed figure leans forward over the book, with a rounded face and glasses.
  const body=new THREE.Group();body.position.set(0,1.95,-.43);body.rotation.x=.14;world.add(body);
  const torso=mesh(new THREE.CylinderGeometry(.43,.33,.94,28),coat,body);torso.scale.z=.66;
  ball(-.33,.32,0,.20,.20,.21,coat,body);ball(.33,.32,0,.20,.20,.21,coat,body);
  box(.23,.64,.045,shirt,0,.12,.275,.025,body);
  const lapelL=box(.12,.41,.06,coat,-.13,.23,.307,.02,body);lapelL.rotation.z=.23;
  const lapelR=box(.12,.41,.06,coat,.13,.23,.307,.02,body);lapelR.rotation.z=-.23;
  ball(0,.02,.323,.022,.022,.015,gold,body);
  const neck=mesh(new THREE.CylinderGeometry(.13,.15,.21,20),skin);neck.position.set(0,2.53,-.26);
  const head=new THREE.Group();head.position.set(0,2.98,-.08);world.add(head);
  ball(0,0,0,.36,.43,.34,skin,head);ball(-.35,-.015,0,.065,.09,.055,skin,head);ball(.35,-.015,0,.065,.09,.055,skin,head);
  const hairCap=mesh(new THREE.SphereGeometry(.38,28,18,0,Math.PI*2,0,1.46),hair,head);hairCap.position.set(0,.105,-.045);hairCap.scale.set(1,1.11,1.02);
  for(const [x,y,z,r] of [[-.23,.36,.04,.16],[-.06,.43,.08,.17],[.14,.40,.02,.17],[.27,.29,-.02,.14],[-.29,.22,-.11,.13]])ball(x,y,z,r,r*.8,r,hair,head);
  ball(0,-.035,.325,.062,.065,.08,skin,head);
  for(const x of [-.135,.135]){ball(x,.035,.312,.027,.018,.019,hair,head);const frame=mesh(new THREE.TorusGeometry(.106,.012,8,32),gold,head);frame.position.set(x,.04,.343);frame.scale.y=.84;}
  const bridge=mesh(new THREE.CylinderGeometry(.01,.01,.065,8),gold,head);bridge.rotation.z=Math.PI/2;bridge.position.set(0,.05,.35);
  const smile=mesh(new THREE.TorusGeometry(.07,.007,6,20,Math.PI*.56),hair,head);smile.position.set(.033,-.16,.29);smile.rotation.z=3.64;
  // Open book, page edges, ribbon and actual curved, turning sheet.
  for(const side of [-1,1]){
    box(1.085,.055,1.23,cover,side*.55,1.595,.55,.025);
    box(1.01,.09,1.12,paper,side*.525,1.665,.55,.013);
    for(let i=0;i<4;i++)box(.99,.004,1.105,material(i%2?0xd4c9ad:0xe7ddc3),side*.525,1.635+i*.018,.55,.001);
    const face=mesh(new THREE.PlaneGeometry(.99,1.09),texture?new THREE.MeshStandardMaterial({map:texture,roughness:1,side:THREE.DoubleSide}):paper);face.rotation.x=-Math.PI/2;face.position.set(side*.525,1.717,.55);
  }
  const spine=mesh(new THREE.CylinderGeometry(.032,.032,1.24,12),gold);spine.rotation.x=Math.PI/2;spine.position.set(0,1.65,.55);
  box(.045,.009,.45,material(0xa64a35),.14,1.722,1.18,.002);
  const cols=22,rows=10,positions=new Float32Array((cols+1)*(rows+1)*3),uvs=new Float32Array((cols+1)*(rows+1)*2),indices=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const n=j*(cols+1)+i;uvs[n*2]=i/cols;uvs[n*2+1]=j/rows;if(i<cols&&j<rows){const a=n,b=n+1,c=n+cols+1,d=c+1;indices.push(a,c,b,b,c,d);}}
  const pageGeometry=new THREE.BufferGeometry();pageGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));pageGeometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));pageGeometry.setIndex(indices);
  const page=mesh(pageGeometry,new THREE.MeshStandardMaterial({color:palette.paper,map:texture,side:THREE.DoubleSide,roughness:1}));page.frustumCulled=false;
  function turnPage(turn){for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const n=(j*(cols+1)+i)*3,p=pagePoint(i/cols,j/rows,turn);positions[n]=p.x;positions[n+1]=p.y;positions[n+2]=p.z;}pageGeometry.attributes.position.needsUpdate=true;pageGeometry.computeVertexNormals();}
  const shoulderL={x:-.39,y:2.32,z:-.38},shoulderR={x:.39,y:2.32,z:-.38};
  const upperL=limb(shoulderL,{x:-.66,y:1.94,z:.19},.128,coat),lowerL=limb({x:-.66,y:1.94,z:.19},{x:-.57,y:1.81,z:.95},.105,coat);
  const upperR=limb(shoulderR,{x:.68,y:1.96,z:.22},.128,coat),lowerR=limb({x:.68,y:1.96,z:.22},{x:.87,y:1.81,z:.97},.105,coat);
  const elbowL=ball(-.66,1.94,.19,.126,.126,.126,coat),elbowR=ball(.68,1.96,.22,.126,.126,.126,coat);
  const leftHand=ball(-.57,1.81,.95,.105,.065,.16,skin),rightHand=ball(.87,1.81,.97,.105,.065,.16,skin);
  const finger=limb({x:-.57,y:1.8,z:.94},{x:-.57,y:1.77,z:1.11},.027,skin);
  // Archive volumes and a magnifying glass suggest a deliberate search.
  box(.55,.09,.73,cover,-1.30,1.59,.18,.02);box(.51,.10,.67,paper,-1.30,1.68,.18,.01);box(.55,.035,.73,coat,-1.30,1.75,.18,.01);
  const glass=mesh(new THREE.TorusGeometry(.18,.024,10,36),gold);glass.rotation.x=Math.PI/2;glass.position.set(1.27,1.59,.79);limb({x:1.40,y:1.59,z:.93},{x:1.62,y:1.59,z:1.15},.028,cover);
  // Ambient stage, warm studio lighting and soft contact shadows.
  const plinth=mesh(new THREE.CylinderGeometry(2.18,2.23,.07,64),material(variant==='cover'?0x1e473b:0xe4dfcc));plinth.position.set(0,-.045,.1);plinth.receiveShadow=true;
  scene.add(new THREE.HemisphereLight(0xfff3d6,0x344c41,2.6));const key=new THREE.DirectionalLight(0xffefcf,3.0);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=4;key.shadow.camera.bottom=-2;key.shadow.normalBias=.025;key.shadow.bias=-.0001;key.shadow.radius=4;scene.add(key);const fill=new THREE.DirectionalLight(0xd5e6dd,1.3);fill.position.set(4,3,-3);scene.add(fill);
  world.rotation.y=-.10;
  function update(seconds){const pose=readingPose(seconds);body.position.y=1.95+pose.breath;head.rotation.set(pose.headPitch,pose.headYaw,0);head.position.y=2.98+pose.breath;turnPage(pose.turn);page.visible=pose.turning;
    const l=pose.leftHand,r=pose.rightHand,el={x:-.66,y:1.94,z:.19},er={x:.64+r.x*.1,y:1.96+(r.y-1.81)*.44,z:.24};
    placeLimb(upperL,shoulderL,el);placeLimb(lowerL,el,l);placeLimb(upperR,shoulderR,er);placeLimb(lowerR,er,r);elbowL.position.set(el.x,el.y,el.z);elbowR.position.set(er.x,er.y,er.z);leftHand.position.set(l.x,l.y,l.z);rightHand.position.set(r.x,r.y,r.z);rightHand.rotation.z=pose.turning?-pose.turn*.4:0;placeLimb(finger,{x:l.x,y:l.y-.015,z:l.z},{x:l.x,y:l.y-.03,z:l.z+.19});
  }
  update(5.9);
  function dispose(){const geometries=new Set(),mats=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)for(const m of Array.isArray(object.material)?object.material:[object.material])mats.add(m);});for(const g of geometries)g.dispose();for(const m of mats)m.dispose();key.shadow.map?.dispose();}
  return {scene,world,page,head,update,dispose};
}
function createPageTexture(){const canvas=document.createElement('canvas');canvas.width=384;canvas.height=512;const ctx=canvas.getContext('2d');if(!ctx)return null;ctx.fillStyle='#F0E6CF';ctx.fillRect(0,0,384,512);ctx.strokeStyle='#62705B';ctx.globalAlpha=.47;ctx.lineWidth=2;
  ctx.fillStyle='#48664F';ctx.font='19px Georgia';ctx.fillText('LECTURES',38,57);ctx.font='8px monospace';ctx.fillText('ARCHIVE VIVANTE',38,77);
  for(let row=0;row<20;row++){const y=105+row*16,width=row%6===5?190:298;ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(38+width,y);ctx.stroke();}
  ctx.font='12px Georgia';ctx.fillText('01',180,480);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2;return texture;}
export function mountReadingScene(element,{variant='cover',onReady=()=>{},onError=()=>{}}={}){
  let renderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{onError();return ()=>{};}
  renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.className='reading-canvas';element.appendChild(renderer.domElement);
  const texture=createPageTexture(),model=createReadingWorld({texture,variant}),camera=new THREE.OrthographicCamera(-3,3,2.6,-2.1,.1,40);camera.position.set(5,6.2,7);camera.lookAt(0,1.65,.15);
  let frame=0,alive=true,lost=false,inView=true,time=5.9,lastFrame=0,lastClock=0;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const paused=()=>reduced.matches||document.documentElement.dataset.motion==='paused';
  function render(){if(!lost)renderer.render(model.scene,camera);}
  function size(){if(!alive)return;const {width,height}=element.getBoundingClientRect();if(width<1||height<1)return;const aspect=width/height,view=4.8;camera.left=-view*aspect/2;camera.right=view*aspect/2;camera.top=view/2;camera.bottom=-view/2;camera.updateProjectionMatrix();renderer.setSize(width,height,false);render();}
  function animate(now){frame=0;if(!alive||lost||paused()||document.hidden||!inView)return;if(now-lastFrame>=1000/24){time+=lastClock?Math.min((now-lastClock)/1000,.1):0;lastClock=now;lastFrame=now;model.update(time);render();}frame=requestAnimationFrame(animate);}
  function schedule(){cancelAnimationFrame(frame);frame=0;lastClock=0;if(alive&&!lost&&!paused()&&!document.hidden&&inView)frame=requestAnimationFrame(animate);else if(alive)render();}
  function contextLost(event){event.preventDefault();lost=true;onError();cancelAnimationFrame(frame);}
  const resize=new ResizeObserver(size);resize.observe(element);const observer=new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);schedule();});observer.observe(element);
  const motionObserver=new MutationObserver(schedule);motionObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});reduced.addEventListener('change',schedule);document.addEventListener('visibilitychange',schedule);renderer.domElement.addEventListener('webglcontextlost',contextLost);
  size();onReady();schedule();
  return ()=>{alive=false;cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();motionObserver.disconnect();reduced.removeEventListener('change',schedule);document.removeEventListener('visibilitychange',schedule);renderer.domElement.removeEventListener('webglcontextlost',contextLost);model.dispose();texture?.dispose();renderer.dispose();renderer.domElement.remove();};
}
