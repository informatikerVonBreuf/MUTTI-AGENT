import * as THREE from 'three';
import {READER_IMAGE,photoPagePoint,photoPagePose} from './photo-book-motion.mjs';

export function createPhotoBook({texture=null}={}){
  const scene=new THREE.Scene();
  const geometry=new THREE.PlaneGeometry(1,1,40,12),position=geometry.attributes.position;
  // UV order is retained while every vertex is deformed around the same spine.
  const uv=geometry.attributes.uv;
  const material=new THREE.MeshStandardMaterial({color:0xffffff,map:texture,roughness:.94,metalness:0,side:THREE.DoubleSide,transparent:true,opacity:0});
  const page=new THREE.Mesh(geometry,material);scene.add(page);
  scene.add(new THREE.HemisphereLight(0xfff4dc,0x3b4934,2));
  const key=new THREE.DirectionalLight(0xffefd1,1.8);key.position.set(-450,900,700);scene.add(key);
  function update(seconds){const pose=photoPagePose(seconds);material.opacity=pose.opacity;page.visible=pose.opacity>0;
    for(let i=0;i<position.count;i++){const point=photoPagePoint(uv.getX(i),1-uv.getY(i),pose.turn);position.setXYZ(i,point.x,point.y,point.z);}
    position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
  }
  update(.55);
  return {scene,page,update,dispose(){geometry.dispose();material.dispose();}};
}
function pageTexture(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
  const ctx=canvas.getContext('2d');if(!ctx)return null;
  ctx.fillStyle='#e4dcc5';ctx.fillRect(0,0,512,384);
  const glow=ctx.createLinearGradient(0,0,512,0);glow.addColorStop(0,'#6c604644');glow.addColorStop(.16,'#f8edcf18');glow.addColorStop(1,'#baaa7933');ctx.fillStyle=glow;ctx.fillRect(0,0,512,384);
  ctx.fillStyle='#66604c';ctx.font='8px Georgia';ctx.globalAlpha=.52;
  const phrases=['Des archives aux perspectives. Lire, chercher, comprendre.','Chaque lecture ouvre un chemin vers de nouvelles idées.','Observer les détails, rapprocher les sources, garder une trace.'];
  for(let column=0;column<2;column++){for(let row=0;row<31;row++){const text=phrases[(row+column)%phrases.length];ctx.fillText(text.slice(0,45-row%5),30+column*240,25+row*10,213);}}
  // Deterministic paper grain; no texture or font is fetched remotely.
  ctx.globalAlpha=.07;for(let i=0;i<3000;i++){ctx.fillRect((i*73)%512,(i*47)%384,1,1);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2;return texture;
}
export function mountPhotoBook(element,{onReady=()=>{},onError=()=>{}}={}){
  let renderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{onError();return ()=>{};}
  renderer.setClearColor(0,0);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.className='human-reader-canvas';renderer.domElement.setAttribute('aria-hidden','true');element.appendChild(renderer.domElement);
  const texture=pageTexture(),model=createPhotoBook({texture}),camera=new THREE.OrthographicCamera(0,READER_IMAGE.width,READER_IMAGE.height,0,.1,3000);
  camera.position.set(0,0,1500);camera.lookAt(0,0,0);
  let alive=true,lost=false,frame=0,seconds=.55,lastClock=0,lastPaint=0;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const paused=()=>reduced.matches||document.hidden||document.documentElement.dataset.motion==='paused';
  const render=()=>{if(!lost)renderer.render(model.scene,camera);};
  function resize(){const width=element.clientWidth,height=element.clientHeight;if(width>0&&height>0){renderer.setSize(width,height,false);render();}}
  function animate(now){frame=0;if(!alive||lost||paused())return;if(now-lastPaint>=1000/30){seconds+=lastClock?Math.min((now-lastClock)/1000,.12):0;lastClock=now;lastPaint=now;model.update(seconds);render();}frame=requestAnimationFrame(animate);}
  function schedule(){cancelAnimationFrame(frame);frame=0;lastClock=0;if(alive&&!lost&&!paused())frame=requestAnimationFrame(animate);}
  function contextLost(event){event.preventDefault();lost=true;cancelAnimationFrame(frame);onError();}
  renderer.domElement.addEventListener('webglcontextlost',contextLost);
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(element);
  const motionObserver=new MutationObserver(schedule);motionObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);
  resize();onReady();schedule();
  return ()=>{alive=false;cancelAnimationFrame(frame);sizeObserver.disconnect();motionObserver.disconnect();document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);renderer.domElement.removeEventListener('webglcontextlost',contextLost);model.dispose();texture?.dispose();renderer.dispose();renderer.domElement.remove();};
}
