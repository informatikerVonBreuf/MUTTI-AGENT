import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingWorld} from '../src/reading-world.mjs';
import {pagePoint,readingPose} from '../src/reading-motion.mjs';
test('The reader page stays attached to its spine throughout a complete turn',()=>{
  for(let step=0;step<=40;step++){const turn=step/40;for(const v of [0,.5,1]){const spine=pagePoint(0,v,turn);assert.ok(Math.abs(spine.x)<1e-12);assert.equal(spine.y,1.73);}}
  assert.ok(pagePoint(1,.5,0).x>0);assert.ok(pagePoint(1,.5,1).x<0);assert.ok(pagePoint(1,.5,.5).y>2.6);
});
test('Reader and turning-page geometry stay finite over reading and page-turn phases',()=>{
  const model=createReadingWorld();try{for(const time of [0,2,5,5.14,5.9,6.3,7,7.65,8.9,9,18,100]){model.update(time);model.scene.updateMatrixWorld(true);const pose=readingPose(time);assert.equal(model.page.visible,pose.turning);assert.ok(Number.isFinite(model.head.rotation.x));for(const value of model.page.geometry.attributes.position.array)assert.ok(Number.isFinite(value));for(const value of model.page.geometry.attributes.normal.array)assert.ok(Number.isFinite(value));}
  assert.ok(model.scene.getObjectsByProperty('isMesh',true).length>40);
  }finally{model.dispose();}
});
