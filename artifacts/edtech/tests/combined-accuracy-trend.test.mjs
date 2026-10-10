import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

const bundled = await build({entryPoints:[new URL('../src/components/student/CombinedAccuracyTrend.tsx',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
const module = {exports:{}};
new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {boundedAccuracyHistory} = module.exports;
const row = (day,accuracy,available=true) => ({date:`2026-09-${String(day).padStart(2,'0')}`,available,accuracy,correct:accuracy===null?null:0,wrong:accuracy===null?null:1,seconds:0,unanswered:0});

test('only the first through last saved accuracy dates are retained, including real zero accuracy',()=>{
 const input=[row(1,null),row(2,0),row(3,50),row(4,null),row(5,100),row(6,null),row(7,null)];
 const before=structuredClone(input);
 const output=boundedAccuracyHistory(input);
 assert.deepEqual(output.map(r=>r.date),['2026-09-02','2026-09-03','2026-09-04','2026-09-05']);
 assert.deepEqual(output.map(r=>r.accuracy),[0,50,null,100]);
 assert.deepEqual(input,before,'cached query data must not be mutated');
});

test('no graded daily history produces no chart range',()=>{
 for(const rows of [[],[row(1,null)],[row(1,null),row(2,null)], [row(1,100,false)]])assert.deepEqual(boundedAccuracyHistory(rows),[]);
});

test('one recorded day is retained without padding empty dates',()=>{
 assert.deepEqual(boundedAccuracyHistory([row(1,null),row(2,0),row(3,null)]),[row(2,0)]);
});

test('unavailable, nonfinite and invalid values are gaps, never observations',()=>{
 const output=boundedAccuracyHistory([row(1,NaN),row(2,10),row(3,90,false),row(4,Infinity),row(5,-1),row(6,101),row(7,0),row(8,undefined)]);
 assert.deepEqual(output.map(r=>r.accuracy),[10,null,null,null,null,0]);
});
