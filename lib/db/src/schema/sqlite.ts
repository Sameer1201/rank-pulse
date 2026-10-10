import {
  index,
  integer as sqliteInteger,
  real as sqliteReal,
  customType,
  sqliteTable,
  text as sqliteText,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * The original schema was authored with PostgreSQL builders. These small
 * aliases keep the schema declarations readable while giving Drizzle a
 * SQLite schema for Cloudflare D1.
 */
export const pgTable = sqliteTable;
export const serial = sqliteInteger;
export const integer = sqliteInteger;
export const real = sqliteReal;
export const text = sqliteText;
export { index, unique };

export function boolean<TName extends string>(name: TName) {
  return sqliteInteger(name, { mode: "boolean" });
}

export function timestamp<TName extends string>(
  name: TName,
  _config?: { withTimezone?: boolean },
) {
  const builder = sqliteInteger(name, { mode: "timestamp_ms" });
  return Object.assign(builder, {
    defaultNow: () => builder.$defaultFn(() => new Date()),
  });
}

export function date<TName extends string>(name: TName) {
  return sqliteText(name);
}

export function jsonb<TName extends string>(name: TName) {
  return customType<{
    data: unknown;
    driverData: string | null;
  }>({
    dataType() {
      return "text";
    },
    toDriver(value) {
      return JSON.stringify(value ?? null);
    },
    fromDriver(value) {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value as unknown;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return null;
      }
    },
  })(name);
}

export function numeric<TName extends string>(
  name: TName,
  _config?: { precision?: number; scale?: number },
) {
  return sqliteReal(name);
}
