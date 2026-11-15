import assert from "node:assert/strict";
import { test } from "node:test";
import { stageControls } from "./stageControls.ts";
const stage = {key:"tune",title:"Tune up",minutes:2,output:"Tune every string."};
test("stage controls use supported intent, with safe custom and personal fallbacks",()=>{
  assert.equal(stageControls(stage,true),"tune");
  assert.equal(stageControls({...stage,key:"technique",title:"Technique"},true),"play");
  assert.equal(stageControls({...stage,key:"next",title:"Record and note the next step"},true),"record");
  assert.equal(stageControls({...stage,key:"custom",title:"Ear training"},true),"general");
  assert.equal(stageControls({...stage,key:"custom",title:"Loop",targetBpm:90},true),"play");
  assert.equal(stageControls({...stage,key:"log",title:"Logging"},true),"notes");
  assert.equal(stageControls(stage,false),"general");
});
