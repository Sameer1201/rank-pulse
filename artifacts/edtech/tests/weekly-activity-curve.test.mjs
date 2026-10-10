import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';

const output=await build({entryPoints:[new URL('../src/lib/weekly-activity-curve.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {activityCurvePoints}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const day=(date,correct,wrong=0)=>({date,partial:false,correct,wrong:correct===null?null:wrong,unanswered:correct===null?null:2,minutes:correct===null?null:correct/3,total:correct===null?null:correct+wrong});

test('six-hour points are explicitly estimated, preserve exact endpoints and do not alter daily totals',()=>{
 const daily=[day('2026-10-05',4,2),day('2026-10-06',12,6)];
 const before=structuredClone(daily),points=activityCurvePoints(daily);
 assert.deepEqual(daily,before);
 assert.equal(points.length,5);
 assert.deepEqual(points.map(p=>p.estimated),[false,true,true,true,false]);
 assert.deepEqual(points.map(p=>p.correct),[4,5.25,8,10.75,12]);
 assert.deepEqual(points.map(p=>p.wrong),[2,2.625,4,5.375,6]);
 assert.deepEqual(points.map(p=>p.total),[6,7.875,12,16.125,18]);
 assert.ok(points.every(p=>p.total===p.correct+p.wrong),'estimated total equals estimated answer counts');
 points.slice(1).forEach((p,i)=>assert.equal(p.timestamp-points[i].timestamp,6*3600000));
});

test('missing, upcoming and nonconsecutive days are not bridged or extrapolated',()=>{
 for(const daily of [[],[day('2026-10-05',2)],[day('2026-10-05',2),day('2026-10-06',null)],[day('2026-10-05',null),day('2026-10-06',3)],[day('2026-10-05',2),day('2026-10-07',3)]]){
  const points=activityCurvePoints(daily);
  assert.equal(points.length,daily.length);
  assert.ok(points.every(p=>!p.estimated));
 }
});

test('interpolation respects metric-specific gaps, zeros, peaks and falling values',()=>{
 const daily=[day('2026-10-05',0),{...day('2026-10-06',100),minutes:null},day('2026-10-07',0)];
 const points=activityCurvePoints(daily);
 assert.equal(points.length,9);
 assert.deepEqual(points.map(p=>p.correct),[0,15.625,50,84.375,100,84.375,50,15.625,0]);
 assert.ok(points.filter(p=>p.estimated).every(p=>p.minutes===null));
 assert.equal(points[0].minutes,0);assert.equal(points.at(-1).minutes,0);
});
