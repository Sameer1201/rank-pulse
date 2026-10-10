import { sql } from "drizzle-orm";
type D1QueryResult = {
    rows: Record<string, unknown>[];
    rowCount: number;
    meta: Record<string, unknown>;
};
type DrizzleRemoteRows = unknown[];
export declare function executeD1Sql(query: string, params?: unknown[]): Promise<D1QueryResult>;
/** Atomic D1 transaction for scoped admin operations, never fire-and-forget. */
export declare function executeD1Batch(statements: Array<{
    sql: string;
    params: unknown[];
}>): Promise<void>;
export declare function initializeD1Schema(): Promise<void>;
export declare function d1Callback(query: string, params: unknown[], method: "run" | "all" | "values" | "get"): Promise<{
    rows: DrizzleRemoteRows;
}>;
export declare function d1BatchCallback(queries: Array<{
    sql: string;
    params: unknown[];
    method: "run" | "all" | "values" | "get";
}>): Promise<Array<{
    rows: DrizzleRemoteRows;
}>>;
export declare function buildD1Sql(query: unknown): import("drizzle-orm").QueryWithTypings;
export { sql };
//# sourceMappingURL=d1.d.ts.map