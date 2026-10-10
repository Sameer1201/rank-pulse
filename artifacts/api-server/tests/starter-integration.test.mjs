import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fixture} from './helpers/worker-fixture.mjs';
const bundle=await build({entryPoints:[new URL('../../starter-worker/src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {default:proxy}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const manifest=JSON.parse(readFileSync(new URL('../src/lib/starter-manifest.json',import.meta.url)));
const qid=manifest.questions[0];
test('real student/admin routes use authenticated Starter proxy, not retained source content/state',async t=>{
 const main=fixture(),starter=fixture();t.after(()=>{main.sql.close();starter.sql.close();});
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async(input,init)=>{const request=new Request(input,init);assert.equal(new URL(request.url).origin,'https://starter.test');return proxy.fetch(request,{STARTER_DB:starter.env.DB,STARTER_PROXY_TOKEN:'fixture-only'});};
 Object.assign(main.env,{STARTER_ENABLED:'true',STARTER_PROXY_URL:'https://starter.test',STARTER_PROXY_TOKEN:'fixture-only'});
 for(const f of [main,starter]){
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
    INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Digital');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Boolean');
    UPDATE student_activity_tracking SET started_at=0;`);
  f.sql.prepare(`INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,difficulty) VALUES(?,1,1,1,?,'mcq','["Yes","No"]',0,'starter')`).run(qid,f===main?'Old backup':'Starter source');
 }
 main.sql.exec('CREATE VIEW nonstarter_daily_activity_totals AS SELECT * FROM student_daily_activity_totals');
 let r=await main.request(`/api/question-bank/chapters/1/questions?questionId=${qid}`,undefined,{method:'GET',userId:2});
 let body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.questions[0].question,'Starter source');assert.equal(body.questions.length,1);
 r=await main.request(`/api/question-bank/questions/${qid}/time`,{exam:'gate',timeSpentSeconds:25},{userId:2});body=await r.json();assert.equal(r.status,200,JSON.stringify(body));
 assert.equal(starter.sql.prepare('SELECT time_spent_seconds s FROM student_question_timers').get().s,25);
 assert.equal(main.sql.prepare('SELECT COUNT(*) n FROM student_question_timers').get().n,0);
 r=await main.request(`/api/question-bank-questions/${qid}/attempt`,{answer:0},{userId:2});body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.isCorrect,true);
 assert.equal(starter.sql.prepare('SELECT attempt_count n FROM question_bank_question_progress').get().n,1);
 assert.equal(main.sql.prepare('SELECT COUNT(*) n FROM question_bank_question_progress').get().n,0);
 r=await main.request(`/api/question-bank-questions/${qid}`,{correctAnswer:1},{method:'PATCH',userId:1});assert.equal(r.status,200,await r.text());
 assert.equal(starter.sql.prepare('SELECT last_is_correct n FROM question_bank_question_progress').get().n,0);
 assert.equal(starter.sql.prepare('SELECT wrong,seconds FROM student_daily_activity_totals').get().wrong,1);
 assert.equal(starter.sql.prepare('SELECT wrong,seconds FROM student_daily_activity_totals').get().seconds,25);
 assert.equal(main.sql.prepare('SELECT correct_answer n FROM question_bank_questions').get().n,0,'old backup is never edited');
 r=await proxy.fetch(new Request('https://starter.test/query',{method:'POST',body:'{}'}),{STARTER_DB:starter.env.DB,STARTER_PROXY_TOKEN:'fixture-only'});assert.equal(r.status,401);
});
