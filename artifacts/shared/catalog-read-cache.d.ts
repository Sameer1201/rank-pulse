export function isCatalogCountRead(sql: string): boolean;
export function changesCatalog(sql: string): boolean;
export function catalogProxyIdentity(endpoint: string, credential: string): object;
export function readCatalogCount<T>(db: object, sql: string, params: unknown[], method: string, load: () => Promise<T>, now?: number): Promise<T>;
export function writeCatalog<T>(db: object, sqls: string[], load: () => Promise<T>): Promise<T>;
