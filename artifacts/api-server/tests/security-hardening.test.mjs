import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const legacy = password => createHash('sha256').update(password + 'edtech_salt_2024').digest('hex');
function setup(t) {
  const f = fixture();
  t.after(() => f.sql.close());
  for (const name of ['20261002_jam_pyq_question_time.sql', '20261002_student_question_timers.sql'])
    f.sql.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  f.sql.prepare("UPDATE users SET subject='GATE',status='active',password_hash=? WHERE id=2").run(legacy('existing-password'));
  f.sql.exec(`INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Preview'),(2,1,'Other');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,image_data)
      VALUES(1,1,1,1,'Example','mcq','["A","B","C","D"]',0,'data:image/png;base64,aGVsbG8='),
      (2,1,1,2,'Other example','mcq','["A","B","C","D"]',0,NULL);
    INSERT INTO question_bank_saved_questions(question_id,student_id) VALUES(1,2);`);
  return f;
}
const imagePath = '/api/question-bank/questions/1/image';
const chapterPath = '/api/question-bank/chapters/1/questions?questionId=1';

test('anonymous image reads fail before querying question contents', async t => {
  const f = setup(t);
  const prepare = f.env.DB.prepare;
  f.env.DB.prepare = query => { assert.doesNotMatch(query, /question_bank_questions/); return prepare(query); };
  const response = await f.request(imagePath, undefined, { method:'GET' });
  assert.equal(response.status,401);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

for (const [label,sql] of [
  ['wrong exam', "UPDATE users SET subject='NEET' WHERE id=2"],
  ['rejected student', "UPDATE users SET status='rejected' WHERE id=2"],
  ['locked chapter', 'UPDATE chapters SET is_locked=1 WHERE id=1'],
  ['locked subject', 'UPDATE subjects SET is_locked=1 WHERE id=1'],
  ['locked class', 'UPDATE classes SET is_locked=1 WHERE id=1'],
  ['unpaid access', `UPDATE users SET student_profile_data='{"studentFeatureAccess":{"questionBankLocked":true}}' WHERE id=2`],
]) test(`${label}: content, image, bookmarks and attempts denied`, async t => {
  const f = setup(t); f.sql.exec(sql);
  for (const path of [chapterPath,imagePath]) assert.equal((await f.request(path,undefined,{method:'GET',userId:2})).status,403,path);
  for (const operation of ['save','attempt','report']) {
    assert.equal((await f.request(`/api/question-bank-questions/1/${operation}`,{answer:0,reason:'test'},{userId:2})).status,403,operation);
  }
  const saved = await f.request('/api/question-bank/saved-questions?limit=20',undefined,{method:'GET',userId:2});
  if (saved.status === 200) assert.deepEqual((await saved.json()).questions,[]);
  else assert.equal(saved.status,403);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM question_bank_question_progress').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM question_bank_saved_questions').get().n,1);
});

test('authorized students and admins retain reads and bookmarks',async t => {
  const f=setup(t);
  for (const userId of [1,2]) for (const path of [chapterPath,imagePath])
    assert.equal((await f.request(path,undefined,{method:'GET',userId})).status,200);
  const saved=await f.request('/api/question-bank/saved-questions?limit=20',undefined,{method:'GET',userId:2});
  assert.deepEqual((await saved.json()).questions.map(q=>q.id),[1]);
  assert.equal((await f.request('/api/question-bank-questions/2/save',{}, {userId:2})).status,200);
  f.sql.exec('UPDATE chapters SET is_locked=1 WHERE id=1');
  assert.equal((await f.request(chapterPath,undefined,{method:'GET',userId:1})).status,200);
});

test('pending GATE preview stays read-only and cannot read a different chapter',async t=>{
  const f=setup(t); f.sql.exec("UPDATE users SET status='pending' WHERE id=2");
  assert.equal((await f.request(chapterPath,undefined,{method:'GET',userId:2})).status,200);
  assert.equal((await f.request('/api/question-bank/chapters/2/questions',undefined,{method:'GET',userId:2})).status,403);
  assert.equal((await f.request('/api/question-bank-questions/1/save',{}, {userId:2})).status,403);
});

test('logout revokes a captured cookie but keeps another device signed in',async t=>{
  const f=setup(t), cookie=f.sessionCookie(2), other=f.sessionCookie(2);
  assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie})).status,200);
  assert.equal((await f.request('/api/auth/logout',{}, {cookie})).status,200);
  assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie})).status,401);
  assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie:other})).status,200);
  assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie:f.sessionCookie(2,Date.now()-1)})).status,401);
  const row=f.sql.prepare('SELECT token_hash FROM auth_sessions LIMIT 1').get();
  assert.match(row.token_hash,/^[a-f0-9]{64}$/);
  assert.notEqual(row.token_hash,other.slice(7));
});

test('legacy password upgrades to salted adaptive hash and remains usable',async t=>{
  const f=setup(t);
  const login=()=>f.request('/api/auth/login',{username:'student',password:'existing-password'});
  const first=await login(); assert.equal(first.status,200,await first.text());
  const hash=f.student().password_hash; assert.match(hash,/^scrypt\$16384\$8\$5\$/);
  assert.equal((await login()).status,200); assert.equal(f.student().password_hash,hash);
  assert.equal((await f.request('/api/auth/login',{username:'student',password:'wrong-password'})).status,401);
});

test('password change atomically revokes all devices; new password works',async t=>{
  const f=setup(t), a=f.sessionCookie(2), b=f.sessionCookie(2);
  const response=await f.request('/api/auth/change-password',{currentPassword:'existing-password',newPassword:'updated-password'}, {cookie:a});
  assert.equal(response.status,200,await response.text());
  for (const cookie of [a,b]) assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie})).status,401);
  assert.equal((await f.request('/api/auth/login',{username:'student',password:'existing-password'})).status,401);
  assert.equal((await f.request('/api/auth/login',{username:'student',password:'updated-password'})).status,200);
});

test('origin allowlist rejects credentialed foreign requests and hostile preflights',async t=>{
  const f=setup(t);
  for (const origin of ['https://evil.example','https://app.example.test.evil.example','null']) {
    for (const method of ['OPTIONS','POST']) {
      const response=await f.request('/api/auth/logout',undefined,{method,userId:2,headers:{origin}});
      assert.equal(response.status,403); assert.equal(response.headers.get('access-control-allow-origin'),null);
    }
  }
  const response=await f.request('/api/auth/login',undefined,{method:'OPTIONS',headers:{origin:f.env.PUBLIC_APP_URL}});
  assert.equal(response.status,204); assert.equal(response.headers.get('access-control-allow-origin'),f.env.PUBLIC_APP_URL);
  assert.equal((await f.request('/api/auth/logout',undefined,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
});

test('disabled accounts cannot reuse sessions or log in',async t=>{
  const f=setup(t), cookie=f.sessionCookie(2);
  f.sql.exec("UPDATE users SET status='disabled' WHERE id=2");
  assert.equal((await f.request(chapterPath,undefined,{method:'GET',cookie})).status,401);
  assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie})).status,403);
  assert.equal((await f.request('/api/auth/login',{username:'student',password:'existing-password'})).status,403);
});

test('login throttling persists across requests without storing raw identifiers',async t=>{
  const f=setup(t);
  for(let i=0;i<10;i++) assert.equal((await f.request('/api/auth/login',{username:'student',password:'wrong'})).status,401);
  const response=await f.request('/api/auth/login',{username:'student',password:'wrong'});
  assert.equal(response.status,429); assert.equal(response.headers.get('retry-after'),'300');
  for(const row of f.sql.prepare('SELECT bucket FROM auth_rate_limits').all()) assert.match(row.bucket,/^[a-f0-9]{64}$/);
});
