import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';

const bundled=await build({entryPoints:[new URL('../src/lib/question-bank-filter.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {readQuestionBankFilter,questionBankFilterSearch,matchesQuestionBankFilter}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('practice URLs preserve the selected filter and saved-only mode; unknown filters default to all',()=>{
 for(const filter of ['all','unattempted','attempted','starter'])for(const saved of [false,true]){
  const search=questionBankFilterSearch(filter,saved);
  assert.equal(readQuestionBankFilter(search),filter);
  assert.equal(new URLSearchParams(search).get('saved'),saved?'1':null);
 }
 assert.equal(questionBankFilterSearch('all'),'');
 for(const search of ['', '?filter=bad', '?filter=UNATTEMPTED', '?saved=1'])assert.equal(readQuestionBankFilter(search),'all');
});

test('visited without submitting stays unattempted; correct, wrong and local queued answers are attempted',()=>{
 const rows=[{id:1,progress:{attemptCount:1}},{id:2,progress:null,timeSpentSeconds:60},{id:3,progress:{attemptCount:1}},{id:4,progress:{attemptCount:0}},{id:5,difficulty:' Starter ',progress:null}];
 assert.deepEqual(rows.filter(q=>matchesQuestionBankFilter(q,'unattempted')).map(q=>q.id),[2,4,5]);
 assert.deepEqual(rows.filter(q=>matchesQuestionBankFilter(q,'attempted')).map(q=>q.id),[1,3]);
 assert.deepEqual(rows.filter(q=>matchesQuestionBankFilter(q,'starter')).map(q=>q.id),[5]);
 assert.equal(matchesQuestionBankFilter(rows[1],'unattempted',true),false);
 assert.equal(matchesQuestionBankFilter(rows[1],'attempted',true),true);
 assert.equal(rows.filter(q=>matchesQuestionBankFilter(q,'all')).length,5);
});
