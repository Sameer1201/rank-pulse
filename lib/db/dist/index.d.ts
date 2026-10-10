import * as schema from "./schema";
export declare const db: import("drizzle-orm/sqlite-proxy").SqliteRemoteDatabase<typeof schema> & {
    execute: (query: unknown) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        meta: Record<string, unknown>;
    }>;
};
export { initializeD1Schema } from "./d1";
export { executeD1Sql, executeD1Batch } from "./d1";
export * from "./schema";
//# sourceMappingURL=index.d.ts.map