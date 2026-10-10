import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const bundled=await build({entryPoints:[new URL('../src/lib/questionBankPartition.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {questionBankMembershipPredicate:predicate}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
test('partition predicates retain exact membership without building a bank-wide ID list',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE question_bank_questions(id INTEGER PRIMARY KEY,subject_id,class_id);
      INSERT INTO question_bank_questions VALUES(1,33,1),(2,12,2),(3,12,1);
      WITH RECURSIVE ids(x) AS (SELECT 4 UNION ALL SELECT x+1 FROM ids WHERE x<10000)
      INSERT INTO question_bank_questions SELECT x,33,2 FROM ids;`);
    for(const table of ['question_bank_question_progress','question_bank_saved_questions','question_bank_reports','test_question_bank_links']){
      const column=table==='test_question_bank_links'?'question_bank_question_id':'question_id';
      db.exec(`CREATE TABLE ${table}(${column} INTEGER NOT NULL,student_id INTEGER);CREATE INDEX ${table}_student ON ${table}(student_id);
        INSERT INTO ${table} VALUES(1,2),(2,2),(3,2),(20000,2),(4,3);`);
      for(const [field,ids]of [['subject_id',[33,39,44]],['class_id',[2]]])for(const included of [true,false]){
        const matching=field==='class_id'?included:true;
        const before=`${column} ${included?'IN':'NOT IN'} (SELECT id FROM question_bank_questions WHERE ${field} ${matching?'IN':'NOT IN'} (${ids.join(',')}))`;
        const after=predicate(table,field,ids,included,matching);
        const sql=p=>`SELECT ${column} FROM ${table} WHERE student_id=2 AND (${p}) ORDER BY ${column}`;
        assert.deepEqual(db.prepare(sql(after)).all(),db.prepare(sql(before)).all());
        const plan=db.prepare('EXPLAIN QUERY PLAN '+sql(after)).all().map(row=>row.detail).join('\n');
        assert.match(plan,/SEARCH shard_question(?: EXISTS)? USING INTEGER PRIMARY KEY/);
        assert.doesNotMatch(plan,/SCAN shard_question|LIST SUBQUERY/);
      }
    }
  }finally{db.close();}
});
