import {Router} from 'express';
import {executeD1Sql,executeD1Batch} from '@workspace/db';
import {getSignedUserId} from '../lib/authUtils';
import {listAttemptedTests,resetTestAttempt,readStudentTestResets,remoteResetStore,TestResetError,type ResetStore} from '../lib/testAttemptReset';
const router=Router();
const main: ResetStore={all:async(sql,params=[]) => (await executeD1Sql(sql,params)).rows,batch:executeD1Batch};
const psu=()=>process.env.PSU_PROXY_URL&&process.env.PSU_PROXY_TOKEN?remoteResetStore(process.env.PSU_PROXY_URL,process.env.PSU_PROXY_TOKEN):null;
router.use('/users',async(req,res,next)=>{
  if(!/\/(attempted-tests|test-attempts\/reset|test-attempt-resets)$/.test(req.path))return next();
  res.setHeader('Cache-Control','no-store');
  try {
    const id=getSignedUserId(req);
    if(!id)return res.status(401).json({error:'Not authenticated'});
    const [caller]=await main.all('SELECT id,role FROM users WHERE id=?',[id]);
    const own=req.path==='/me/test-attempt-resets'&&req.method==='GET';
    if(!caller||(own?caller.role!=='student':!['admin','super_admin'].includes(String(caller.role))))return res.status(403).json({error:'Forbidden'});
    if(own)return res.json(await readStudentTestResets(main,id,Math.max(0,Number(req.query.since)||0),String(req.query.afterId??'')));
    const match=req.path.match(/^\/(\d+)\/(attempted-tests|test-attempts\/reset)$/);
    if(!match)return res.status(400).json({error:'Invalid student ID'});
    if(req.method==='GET'&&match[2]==='attempted-tests')return res.json(await listAttemptedTests(main,psu(),Number(match[1]),Math.min(50,Math.max(1,Number(req.query.limit)||30)),Math.max(0,Number(req.query.offset)||0),String(req.query.search??'').slice(0,150)));
    if(req.method==='POST'&&match[2]==='test-attempts/reset')return res.json(await resetTestAttempt(main,psu(),id,Number(match[1]),req.body??{}));
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(error instanceof TestResetError?error.status:503).json({error:error instanceof TestResetError?error.message:'Test reset could not complete. Refresh and retry; the recovery archive is retained.'});}
});
export default router;
