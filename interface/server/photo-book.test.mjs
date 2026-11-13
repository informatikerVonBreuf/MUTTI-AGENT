import test from 'node:test';
import assert from 'node:assert/strict';
import {fitReaderImage,photoPagePoint,photoPagePose,READER_IMAGE,BOOK_CORNERS} from '../src/photo-book-motion.mjs';
import {createPhotoBook} from '../src/photo-book-scene.mjs';
test('La page photo reste fixée aux deux extrémités de la reliure pendant toute la rotation',()=>{
  for(let step=0;step<=100;step++)for(const [v,spine] of [[0,BOOK_CORNERS.spineFar],[1,BOOK_CORNERS.spineNear]]){
    const p=photoPagePoint(0,v,step/100);assert.equal(p.x,spine.x);assert.equal(p.y,READER_IMAGE.height-spine.y);assert.equal(p.z,0);
  }
  assert.equal(photoPagePoint(1,0,0).x,BOOK_CORNERS.rightFar.x);
  assert.equal(photoPagePoint(1,0,1).x,BOOK_CORNERS.leftFar.x);
  assert.ok(photoPagePoint(1,.5,.5).z>200);
});
test('Le cadrage couvre les formats mobile et bureau sans décaler le maillage de la photo',()=>{
  for(const [width,height,x,y] of [[390,325,.71,.80],[500,850,.64,.76],[1440,700,.7,.82],[340,340,.67,.8]]){
    const fit=fitReaderImage(width,height,x,y);assert.ok(fit.width>=width-.001&&fit.height>=height-.001);
    assert.ok(Math.abs(fit.width/fit.height-READER_IMAGE.width/READER_IMAGE.height)<1e-10);
    assert.ok(fit.left<=0&&fit.top<=0);assert.ok(fit.left+fit.width>=width-.001&&fit.top+fit.height>=height-.001);
  }
});
test('Le cycle automatique se répète, traverse le relief et garde sa géométrie finie',()=>{
  const model=createPhotoBook();try{
    for(let step=0;step<=200;step++){const time=step*.1;model.update(time);const pose=photoPagePose(time),repeat=photoPagePose(time+6.4);assert.ok(Math.abs(pose.turn-repeat.turn)<1e-10);assert.ok(pose.opacity>=0&&pose.opacity<=1);for(const value of model.page.geometry.attributes.position.array)assert.ok(Number.isFinite(value));for(const value of model.page.geometry.attributes.normal.array)assert.ok(Number.isFinite(value));}
  }finally{model.dispose();}
});
