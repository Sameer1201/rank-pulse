import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Inventory repository schemas in disposable databases, never production data.
const source = await readFile(new URL('../lib/db/src/d1Schema.ts', import.meta.url), 'utf8');
const mainSchema = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
const qbSchema = await readFile(new URL('../artifacts/api-server/migrations/20260920_question_bank_database.sql', import.meta.url), 'utf8');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const inventory = (schema) => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(schema);
    return db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((table) => ({
      ...table,
      columns: db.prepare(`PRAGMA table_info(${quote(table.name)})`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all(),
      indexes: db.prepare(`PRAGMA index_list(${quote(table.name)})`).all().map((index) => ({
        ...index,
        columns: db.prepare(`PRAGMA index_xinfo(${quote(index.name)})`).all(),
        sql: db.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?').get('index', index.name)?.sql ?? null,
      })),
    }));
  } finally { db.close(); }
};
console.log(JSON.stringify({
  scope: 'Repository schema inventory, not a live D1 inspection. The main baseline retains legacy QBank tables; production routing uses the separate QBank schema.',
  mainBaseline: inventory(mainSchema),
  questionBank: inventory(qbSchema),
}, null, 2));
