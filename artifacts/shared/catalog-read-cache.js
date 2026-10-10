// Only public-content aggregate counts, never question content, answers,
// authentication, locks, bookmarks, reports or student progress. HTTP responses
// remain private/no-store; this bounded cache lives inside one Worker isolate.
const catalogTables = new Set(['question_bank_questions', 'pyq_questions', 'psu_questions', 'psu_tests', 'jam_qb_catalog_counts', 'jam_pyq_catalog_counts']);
const states = new WeakMap();
const proxyIdentities = new Map();
const TTL = 30_000;
const MAX_ENTRIES = 128;
const MAX_BYTES = 2 * 1024 * 1024;

// A proxy object is recreated for each API request. Reuse a bounded identity
// per endpoint AND service credential, never per student/session credential.
export function catalogProxyIdentity(endpoint, credential) {
  const key = JSON.stringify([endpoint, credential]);
  let identity = proxyIdentities.get(key);
  if (!identity) {
    if (proxyIdentities.size >= 16) proxyIdentities.delete(proxyIdentities.keys().next().value);
    identity = {}; proxyIdentities.set(key, identity);
  }
  return identity;
}

function stateFor(db) {
  let state = states.get(db);
  if (!state) { state = { entries: new Map(), flights: new Map(), bytes: 0, epoch: 0, writes: 0 }; states.set(db, state); }
  return state;
}

export function isCatalogCountRead(sql) {
  // Fail closed on comments, subqueries, joins, unions and unknown expressions.
  const text = String(sql).trim();
  if (text.length > 64_000 || /--|\/\*|;|\b(JOIN|UNION|WITH|OVER)\b/i.test(text)) return false;
  const parts = /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_]+)\b([\s\S]*)$/i.exec(text);
  if (!parts || !catalogTables.has(parts[2].toLowerCase())) return false;
  // json_each is the sole permitted subquery, used for internally selected IDs.
  // Check it separately after replacing this exact, parameterized form.
  return countProjection(parts[1]) && safeTail(parts[3]);
}

function countProjection(projection) {
  let sawCount = false;
  const stripped = projection.replace(/\b(?:COUNT\s*\(\s*\*\s*\)|COUNT\s*\(\s*DISTINCT\s+NULLIF\s*\(\s*chapter\s*,\s*''\s*\)\s*\)|SUM\s*\(\s*question_count\s*\)|MIN\s*\(\s*chapter_order\s*\))/ig, () => { sawCount = true; return 'aggregate'; });
  // No free-form SQL or arbitrary fields in the projection. Aliases are output
  // names only; they cannot introduce a separate expression.
  const fields = stripped.replace(/COALESCE\s*\(\s*aggregate\s*,\s*0\s*\)/ig, 'aggregate').split(',');
  return sawCount && fields.every(field => /^\s*(?:aggregate|COALESCE\s*\(\s*aggregate\s*,\s*0\s*\)|class_id|subject_id|chapter_id|psu_id|exam|subject|chapter)\s*(?:AS\s+[a-z_]\w*)?\s*$/i.test(field));
}

function safeTail(tail) {
  const stripped = tail.replace(/\(\s*SELECT\s+value\s+FROM\s+json_each\s*\(\s*\?\s*\)\s*\)/ig, '(?)');
  if (/\b(?:SELECT|FROM|JOIN|RETURNING)\b/i.test(stripped)) return false;
  // Identity predicates are content taxonomy only, never a student/user ID.
  const words = stripped.replace(/'[^']*(?:''[^']*)*'/g, '').match(/[a-z_]\w*/ig) ?? [];
  const allowed = new Set(['where','and','or','not','in','is','null','group','by','order','asc','desc','limit','offset','collate','nocase','class_id','subject_id','chapter_id','psu_id','exam','subject','chapter','chapter_order','id','question_bank_questions','pyq_questions','psu_questions','psu_tests','jam_qb_catalog_counts','jam_pyq_catalog_counts']);
  return words.every(word => allowed.has(word.toLowerCase()));
}

function remove(state, key) {
  const entry = state.entries.get(key);
  if (entry) { state.bytes -= entry.bytes; state.entries.delete(key); }
}

function reused(result) {
  return { ...result, meta: { ...result.meta, rows_read: 0, rows_written: 0, catalog_cache_hit: true } };
}

export async function readCatalogCount(db, sql, params, method, load, now = Date.now()) {
  if (!['all', 'first'].includes(method) || !isCatalogCountRead(sql)) return load();
  const key = JSON.stringify([sql, params, method]);
  if (key.length > 70_000) return load();
  const state = stateFor(db);
  if (state.writes) return load();
  const entry = state.entries.get(key);
  if (entry && entry.until > now) return reused(JSON.parse(entry.serialized));
  remove(state, key);
  const running = state.flights.get(key);
  if (running) return reused(await running);
  if (state.flights.size >= MAX_ENTRIES) return load();
  const epoch = state.epoch;
  const flight = Promise.resolve().then(load).then(loaded => {
    const sourceTime = Number(loaded?.meta?.catalog_read_at);
    const readAt = Number.isFinite(sourceTime) && sourceTime > 0 ? Math.min(now, sourceTime) : now;
    return { ...loaded, meta: { ...loaded?.meta, catalog_read_at: readAt } };
  });
  state.flights.set(key, flight);
  try {
    const result = await flight;
    // Preserve source age through stacked API/proxy caches. A 29-second-old
    // proxy result must not gain a fresh 30-second lifetime in the API gateway.
    const readAt = result.meta.catalog_read_at;
    if (state.epoch === epoch && !state.writes && result?.ok && Array.isArray(result.results)) {
      const serialized = JSON.stringify(result);
      const bytes = new TextEncoder().encode(serialized).byteLength + new TextEncoder().encode(key).byteLength;
      if (bytes <= MAX_BYTES / 8) {
        for (const [oldKey, old] of state.entries) if (old.until <= now) remove(state, oldKey);
        while (state.entries.size >= MAX_ENTRIES || state.bytes + bytes > MAX_BYTES) remove(state, state.entries.keys().next().value);
        state.entries.set(key, { serialized, bytes, until: readAt + TTL }); state.bytes += bytes;
      }
    }
    return result;
  } finally { if (state.flights.get(key) === flight) state.flights.delete(key); }
}

export function changesCatalog(sql) {
  const match = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z_]\w*)/i.exec(String(sql));
  return Boolean(match && (catalogTables.has(match[1].toLowerCase()) || match[1].toLowerCase() === 'psus'));
}

/** Clear before AND after mutation; an overlapping old read cannot repopulate
 * the cache. Other isolates expire independently within 30 seconds. */
export async function writeCatalog(db, sqls, load) {
  if (!sqls.some(changesCatalog)) return load();
  const state = stateFor(db);
  const clear = () => { state.epoch++; state.entries.clear(); state.flights.clear(); state.bytes = 0; };
  state.writes++; clear();
  try { return await load(); }
  finally { state.writes--; clear(); }
}
