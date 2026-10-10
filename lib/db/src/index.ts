import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";
import {
  buildD1Sql,
  d1BatchCallback,
  d1Callback,
  executeD1Sql,
} from "./d1";

const remoteDb = drizzle(
  d1Callback,
  async (queries) =>
    d1BatchCallback(
      queries.map(({ sql: query, params, method }) => ({ sql: query, params, method })),
    ),
  { schema },
);

export const db = Object.assign(remoteDb, {
  execute: async (query: unknown) => {
    const built = buildD1Sql(query);
    const result = await executeD1Sql(built.sql, built.params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      meta: result.meta,
    };
  },
});

export { initializeD1Schema } from "./d1";
export { executeD1Sql, executeD1Batch } from "./d1";
export * from "./schema";
