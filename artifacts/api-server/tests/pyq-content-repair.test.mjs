import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const bundled=await build({entryPoints:[new URL('../src/lib/pyqContentRepair.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {pyqContentRepairStatements}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const item={id:1,question:'<p>New math</p>',expectedQuestion:'old',expectedUpdatedAt:'2026-09-22',options:['a','b'],explanation:'new',imageData:null};
const payload=questions=>({exam:'GATE ECE',subject:'Analog Circuits',questions});
test('content repair preserves IDs, answer keys, attempts and refuses stale or wrong-subject rows',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE pyq_questions(id INTEGER PRIMARY KEY,exam TEXT,subject TEXT,question TEXT,options_json TEXT,explanation TEXT,image_data TEXT,updated_at TEXT,correct_answer INTEGER);
 CREATE TABLE progress(question_id INTEGER,attempts INTEGER);
 INSERT INTO pyq_questions VALUES(1,'GATE ECE','Analog Circuits','old','["a","b"]','old',NULL,'2026-09-22',1);
 INSERT INTO progress VALUES(1,7);`);
 const apply=body=>pyqContentRepairStatements(body).map(s=>db.prepare(s.sql).run(...s.params).changes);
 assert.deepEqual(apply({...payload([item]),subject:'Wrong subject'}),[0]);
 assert.deepEqual(apply(payload([{...item,expectedUpdatedAt:'stale'}])),[0]);
 assert.deepEqual(apply(payload([item])),[1]);
 assert.equal(db.prepare('SELECT correct_answer FROM pyq_questions').get().correct_answer,1);
 assert.equal(db.prepare('SELECT attempts FROM progress WHERE question_id=1').get().attempts,7);
 assert.deepEqual(apply(payload([item])),[0]);
 db.close();
});
test('rejects invalid and duplicate repair IDs and unbounded batches',()=>{
 assert.throws(()=>pyqContentRepairStatements(payload([item,item])));
 assert.throws(()=>pyqContentRepairStatements(payload([{...item,id:-1}])));
 assert.throws(()=>pyqContentRepairStatements(payload(Array(26).fill(item))));
 assert.throws(()=>pyqContentRepairStatements(payload([{...item,question:''}])));
});
