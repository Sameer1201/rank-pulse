import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const bundle=await build({entryPoints:[new URL('../src/lib/student-activity-sorting.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {sortStudents,studentSortOptions}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const students=[{id:1,name:'Beta',createdAt:'2026-01-01'},{id:2,name:'Alpha',createdAt:'2026-02-01'},{id:3,name:'Gamma',createdAt:'2026-03-01'},{id:4,name:'Unknown',createdAt:'2026-04-01'}];
const metrics=new Map([
  [1,{activityCount:12,pyqAttempts:1,questionBankAttempts:10,testCount:1}],
  [2,{activityCount:8,pyqAttempts:5,questionBankAttempts:0,testCount:3}],
  [3,{activityCount:0,pyqAttempts:0,questionBankAttempts:0,testCount:0}],
]);
test('all six fields sort in both directions, missing data stays last and zero is valid',()=>{
  const expected={activity:[1,2,3,4],pyq:[2,1,3,4],'question-bank':[1,2,3,4],tests:[2,1,3,4],name:[4,3,1,2],newest:[4,3,2,1]};
  for(const {key}of studentSortOptions){
    const sorted=direction=>sortStudents(students,key,direction,metrics,s=>s.name).map(s=>s.id);
    assert.deepEqual(sorted('desc'),expected[key],key);
    const descending=expected[key];
    // Numeric ties consistently use name, rather than reversing randomly.
    const ascending=key==='question-bank'?[2,3,1,4]:['name','newest'].includes(key)?[...descending].reverse():[...descending.slice(0,3)].reverse().concat(4);
    assert.deepEqual(sorted('asc'),ascending,key);
  }
  assert.deepEqual(students.map(s=>s.id),[1,2,3,4],'sorting does not mutate query cache');
});
test('search/scoped subset is preserved; deterministic tie-breaker works with null and absent metrics',()=>{
  assert.deepEqual(sortStudents(students.filter(s=>s.id===2), 'pyq','desc',metrics,s=>s.name).map(s=>s.id),[2]);
  assert.deepEqual(sortStudents(students,'activity','asc',new Map(),s=>s.name).map(s=>s.id),[2,1,3,4]);
});
