import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './helpers/worker-fixture.mjs';

function setup() {
 const f=fixture();
 f.sql.exec(`PRAGMA foreign_keys=ON;
  UPDATE users SET status='active' WHERE id=2;
  INSERT INTO users (id,username,password_hash,full_name,email,role,status) VALUES
   (3,'teacher','test','Teacher','teacher@example.test','admin','active'),
   (4,'other','test','Other student','other@example.test','student','active');
  INSERT INTO tests (id,title,created_by) VALUES (1,'Shared test',3);
  INSERT INTO test_submissions (test_id,student_id,answers) VALUES (1,2,'{}'),(1,4,'{}');
  INSERT INTO direct_messages (sender_id,receiver_id,content) VALUES (2,3,'Student message'),(3,2,'Reply'),(3,4,'Keep');
  INSERT INTO user_activity_logs (user_id,action) VALUES (2,'practice'),(4,'practice');
  INSERT INTO user_sessions (user_id,session_token) VALUES (2,'student-session'),(4,'other-session');
  INSERT INTO ai_similar_questions (student_id,source,difficulty,question) VALUES (2,'pyq','easy','Delete'),(4,'pyq','easy','Keep');
  INSERT INTO notifications (user_id,title,message,type) VALUES (2,'Test','Delete','info'),(4,'Test','Keep','info');
  INSERT INTO password_reset_requests (user_id,requested_username,requested_email) VALUES (2,'student','student@example.test');
 `);
 return f;
}
const remove=(f,userId,target=2)=>f.request(`/api/users/${target}`,undefined,{method:'DELETE',userId});

for(const caller of [1,3]) test(`${caller===1?'super admin':'admin'} can delete a student with attempts and messages`,async()=>{
 const f=setup();
 const deletedStudentCookie=f.sessionCookie(2);
 const response=await remove(f,caller);
 assert.equal(response.status,200);
 assert.equal(f.student(),undefined);
 for(const [table,column] of [['test_submissions','student_id'],['direct_messages','receiver_id'],['user_activity_logs','user_id'],['user_sessions','user_id'],['ai_similar_questions','student_id'],['notifications','user_id']]){
  assert.equal(f.sql.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=2`).get().n,0,table);
  assert.equal(f.sql.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=4`).get().n,1,`${table} preserves other student`);
 }
 assert.equal(f.sql.prepare('SELECT count(*) n FROM direct_messages WHERE sender_id=2').get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM password_reset_requests WHERE user_id=2').get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM tests').get().n,1,'shared test preserved');
 assert.equal((await f.request('/api/auth/me',undefined,{method:'GET',cookie:deletedStudentCookie})).status,401,'deleted account session rejected');
});

test('anonymous and student callers cannot delete accounts; staff targets remain protected',async()=>{
 const f=setup();
 for(const [caller,target,status] of [[undefined,2,401],[2,4,403],[3,1,403],[3,3,403],[1,3,403],[3,99999,404]]){
  assert.equal((await remove(f,caller,target)).status,status);
 }
 assert.equal(f.sql.prepare('SELECT count(*) n FROM users').get().n,4);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM test_submissions').get().n,2);
});

test('failed account deletion rolls back every cleanup statement',async()=>{
 const f=setup();
 f.sql.exec("CREATE TRIGGER block_student_delete BEFORE DELETE ON users WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 await assert.rejects(()=>remove(f,3),/test failure/);
 assert(f.student());
 assert.equal(f.sql.prepare('SELECT count(*) n FROM test_submissions WHERE student_id=2').get().n,1);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM direct_messages WHERE sender_id=2 OR receiver_id=2').get().n,2);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM user_sessions WHERE user_id=2').get().n,1);
});
