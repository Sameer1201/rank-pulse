// Non-mutating production measurement. Only aggregate hashes and D1/cache
// metadata are printed; service credentials and returned records stay private.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const target = process.argv[2] ?? 'psu';
const targets = {
  psu: { url: 'https://rankpulse-psu.workspace-psu-worker.workers.dev', token: 'PSU_PROXY_TOKEN' },
  jam: { url: 'https://rankpulse-jam-content.workspace-psu-worker.workers.dev', token: 'JAM_QB_PROXY_TOKEN' },
  qbank: { url: 'https://rankpulse-qbank.rankpulse-qbank.workers.dev', token: 'QB_PROXY_TOKEN' },
};
if (!targets[target]) throw Error('Expected psu, jam or qbank');
let local = '';
try { local = readFileSync('artifacts/api-server/.env.local', 'utf8'); } catch { /* Environment credentials can be used instead. */ }
const key = targets[target].token;
const raw = process.env[key] ?? new RegExp(`^${key}=(.*)$`, 'm').exec(local)?.[1];
const token = raw?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!token) throw Error(`No configured service credential for ${target}; do not paste credentials in chat.`);
const sql = 'SELECT class_id AS classId, COUNT(*) AS count FROM question_bank_questions GROUP BY class_id';
const measurements = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  const response = await fetch(`${targets[target].url}/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({sql, params: [], method: 'all'}),
  });
  if (response.status !== 200) throw Error(`Catalog check failed for ${target}: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok || !Array.isArray(data.results)) throw Error('Catalog result is unavailable');
  measurements.push({ request: i+1, rowsRead: data.meta?.rows_read ?? null,
    cacheHit: data.meta?.catalog_cache_hit === true, rowsReturned: data.results.length,
    elapsedMs: Math.round((performance.now()-start)*10)/10,
    resultHash: createHash('sha256').update(JSON.stringify(data.results)).digest('hex') });
}
const sameResults = measurements.every(row => row.resultHash === measurements[0].resultHash);
if (!sameResults) throw Error('Catalog changed during measurement; no savings comparison can be claimed');
const report = {target,checkedAt:new Date().toISOString(),readOnly:true,sameResults,measurements};
const dir = 'verification/20261007'; mkdirSync(dir,{recursive:true});
writeFileSync(`${dir}/${target}-catalog-cache-reads.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({target,sameResults,measurements:measurements.map(({resultHash,...row})=>row)},null,2));
if (!measurements.some(row=>row.cacheHit && row.rowsRead===0)) {
  console.error('No warm-isolate hit observed; do not claim measured live savings for this sample.');
  process.exitCode = 1;
}
