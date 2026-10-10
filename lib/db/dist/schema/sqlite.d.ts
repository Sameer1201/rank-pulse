import { index, integer as sqliteInteger, real as sqliteReal, text as sqliteText, unique } from "drizzle-orm/sqlite-core";
/**
 * The original schema was authored with PostgreSQL builders. These small
 * aliases keep the schema declarations readable while giving Drizzle a
 * SQLite schema for Cloudflare D1.
 */
export declare const pgTable: import("drizzle-orm/sqlite-core").SQLiteTableFn<undefined>;
export declare const serial: typeof sqliteInteger;
export declare const integer: typeof sqliteInteger;
export declare const real: typeof sqliteReal;
export declare const text: typeof sqliteText;
export { index, unique };
export declare function boolean<TName extends string>(name: TName): import("drizzle-orm/sqlite-core").SQLiteBooleanBuilderInitial<TName>;
export declare function timestamp<TName extends string>(name: TName, _config?: {
    withTimezone?: boolean;
}): import("drizzle-orm/sqlite-core").SQLiteTimestampBuilderInitial<TName> & {
    defaultNow: () => import("drizzle-orm").HasRuntimeDefault<import("drizzle-orm").HasDefault<import("drizzle-orm/sqlite-core").SQLiteTimestampBuilderInitial<TName>>>;
};
export declare function date<TName extends string>(name: TName): import("drizzle-orm/sqlite-core").SQLiteTextBuilderInitial<TName, [string, ...string[]], number | undefined>;
export declare function jsonb<TName extends string>(name: TName): import("drizzle-orm/sqlite-core").SQLiteCustomColumnBuilder<{
    name: "";
    dataType: "custom";
    columnType: "SQLiteCustomColumn";
    data: unknown;
    driverParam: string | null;
    enumValues: undefined;
}>;
export declare function numeric<TName extends string>(name: TName, _config?: {
    precision?: number;
    scale?: number;
}): import("drizzle-orm/sqlite-core").SQLiteRealBuilderInitial<TName>;
//# sourceMappingURL=sqlite.d.ts.map