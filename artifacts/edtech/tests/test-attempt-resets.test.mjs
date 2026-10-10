import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const bundle=await build({entryPoints:[new URL('../src/lib/test-attempt-resets.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {applyTestAttemptReset,readTestResetCursor}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dismissedKey='rankpulse-review-bucket-removed-question-ids';
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
const reset={id:'event1',source:'regular',testId:1,psuId:null,resetAt:1000,questionIds:[11,12]};
test('clears only the selected old draft and targeted bucket dismissals',()=>{
  const s=storage();s.setItem('educonnect-test-draft-1','{"savedAt":500}');s.setItem('educonnect-test-draft-2','{"savedAt":500}');s.setItem(dismissedKey,'[11,12,22]');
  assert.equal(applyTestAttemptReset(s,2,reset),true);assert.equal(s.getItem('educonnect-test-draft-1'),null);assert.notEqual(s.getItem('educonnect-test-draft-2'),null);assert.deepEqual(JSON.parse(s.getItem(dismissedKey)),[22]);assert.deepEqual(readTestResetCursor(s,2),{resetAt:1000,id:'event1'});
});
test('preserves a newer draft and ignores repeat events after new dismissals',()=>{
  const s=storage();s.setItem('educonnect-test-draft-1','{"savedAt":1200}');assert.equal(applyTestAttemptReset(s,2,reset),true);assert.notEqual(s.getItem('educonnect-test-draft-1'),null);
  s.setItem(dismissedKey,'[11]');assert.equal(applyTestAttemptReset(s,2,reset),false);assert.deepEqual(JSON.parse(s.getItem(dismissedKey)),[11]);
});
test('PSU drafts and cursors are scoped; equal timestamps use event ID as tiebreaker',()=>{
  const s=storage();s.setItem('educonnect-test-draft-psu-4-1','{"savedAt":500}');s.setItem('educonnect-test-draft-psu-5-1','{"savedAt":500}');s.setItem('educonnect-test-draft-1','{"savedAt":500}');
  assert.equal(applyTestAttemptReset(s,2,{...reset,source:'psu',psuId:4}),true);assert.equal(s.getItem('educonnect-test-draft-psu-4-1'),null);assert.notEqual(s.getItem('educonnect-test-draft-psu-5-1'),null);assert.notEqual(s.getItem('educonnect-test-draft-1'),null);
  assert.deepEqual(readTestResetCursor(s,3),{resetAt:0,id:''});assert.equal(applyTestAttemptReset(s,2,{...reset,id:'event2'}),true);assert.equal(applyTestAttemptReset(s,2,reset),false);
});
test('corrupted optional storage never breaks practice or prevents cursor advancement',()=>{
  const s=storage();s.setItem('educonnect-test-draft-1','bad json');s.setItem(dismissedKey,'bad json');assert.equal(applyTestAttemptReset(s,2,reset),true);assert.equal(s.getItem('educonnect-test-draft-1'),null);
  const unavailable={getItem(){throw Error('storage denied');},setItem(){throw Error('storage denied');},removeItem(){throw Error('storage denied');}};assert.equal(applyTestAttemptReset(unavailable,2,reset),false);
});
