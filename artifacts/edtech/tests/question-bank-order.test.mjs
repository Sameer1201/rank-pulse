import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';
const result=await build({entryPoints:[new URL('../src/lib/question-bank-order.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {groupStarterQuestions}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));

test('practice precedes starter, stably grouped before paging and navigation',()=>{
 const questions=Array.from({length:60},(_,index)=>({id:index+1,difficulty:index%3===1?' Starter ':'hard',progress:{attemptCount:index},timeSpentSeconds:index*10}));
 const original=[...questions];
 const grouped=groupStarterQuestions(questions);
 assert.deepEqual(grouped.slice(0,40),questions.filter(q=>q.difficulty==='hard'));
 assert.deepEqual(grouped.slice(40),questions.filter(q=>q.difficulty.trim()==='Starter'));
 assert.deepEqual(questions,original);
 assert.equal(new Set(grouped.map(q=>q.id)).size,60);
 assert.equal(grouped[39],questions[59]);
 assert.equal(grouped[40],questions[1]);
 assert.deepEqual(groupStarterQuestions(grouped),grouped);
});
