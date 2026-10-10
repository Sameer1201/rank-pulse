import { readCatalogCount, writeCatalog } from '../../shared/catalog-read-cache.js';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const tables = new Set(['question_bank_questions', 'question_bank_question_progress', 'question_bank_saved_questions', 'question_bank_reports', 'test_question_bank_links', 'student_question_timers', 'student_daily_question_activity', 'student_daily_activity_totals', 'student_activity_tracking', 'jam_qb_catalog_counts']);
export function validate(sql) {
  if (typeof sql !== 'string' || !/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql) || sql.includes(';') || /\b(PRAGMA|ATTACH|DETACH|CREATE|DROP|ALTER|VACUUM|REINDEX)\b/i.test(sql)) throw Error('Invalid data statement');
  const referenced = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+["`]?([a-z_][\w]*)/ig)].map(m=>m[1].toLowerCase());
  if (!referenced.length || referenced.some(t=>!tables.has(t) && !['json_each','set'].includes(t))) throw Error('Table is not available');
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/healthz' && request.method === 'GET') return json({ok:true,service:'starter-questions'});
    if (path !== '/query') return json({ok:false,error:'Not found'},404);
    if (request.method !== 'POST') return json({ok:false,error:'Method not allowed'},405);
    const supplied=request.headers.get('authorization');
    if (!env.STARTER_PROXY_TOKEN || supplied !== `Bearer ${env.STARTER_PROXY_TOKEN}`) return json({ok:false,error:'Unauthorized'},401);
    try {
      const body=await request.json();
      const prepare=item=>{
        const sql=String(item.sql??'').trim().replace(/;\s*$/,''); validate(sql);
        if (!Array.isArray(item.params) || item.params.length>100 || item.params.some(v=>v!==null && !['string','number','boolean'].includes(typeof v))) throw Error('Invalid parameters');
        return env.STARTER_DB.prepare(sql).bind(...item.params);
      };
      if(body.method==='batch') {
        if(!Array.isArray(body.statements)||!body.statements.length||body.statements.length>100) throw Error('Invalid batch');
        const statements = body.statements.map(prepare);
        await writeCatalog(env.STARTER_DB, body.statements.map(item => item.sql), () => env.STARTER_DB.batch(statements)); return json({ok:true,results:[]});
      }
      if(!['all','first','run'].includes(body.method)) throw Error('Invalid method');
      const stmt=prepare(body);
      if(body.method==='first') return json(await readCatalogCount(env.STARTER_DB, body.sql, body.params, body.method, () => writeCatalog(env.STARTER_DB, [body.sql], async () => { const row=await stmt.first(); return {ok:true,results:row?[row]:[]}; })));
      if(body.method==='all') return json(await readCatalogCount(env.STARTER_DB, body.sql, body.params, body.method, () => writeCatalog(env.STARTER_DB, [body.sql], async () => { const result=await stmt.all(); return {ok:true,results:result.results??[],meta:result.meta}; })));
      const result=await writeCatalog(env.STARTER_DB, [body.sql], () => stmt.run()); return json({ok:true,results:result.results??[],meta:result.meta});
    } catch { return json({ok:false,error:'Starter data query failed'},400); }
  },
};
