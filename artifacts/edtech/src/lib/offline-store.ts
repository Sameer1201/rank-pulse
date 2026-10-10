const DATABASE = "rankpulse-offline-practice-v1";
let connection: Promise<IDBDatabase> | undefined;
function open() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
export async function readOffline<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("records").objectStore("records").get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}
export async function listOffline<T>(prefix: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("records").objectStore("records").getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    request.onsuccess = () => resolve(request.result.map(row => row.value));
    request.onerror = () => reject(request.error);
  });
}
export async function writeOffline<T>(key: string, value: T) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Offline storage is full or unavailable"));
  });
}
/** Read/modify/write in one transaction so a refill cannot erase a concurrent save. */
export async function updateOffline<T>(key: string, update: (current: T | undefined) => T | undefined) {
  const db = await open();
  return new Promise<void>((resolve,reject) => {
    const tx = db.transaction('records','readwrite'), store = tx.objectStore('records');
    const request = store.get(key);
    request.onsuccess = () => {
      const value = update(request.result?.value);
      if (value !== undefined) store.put({key,value});
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not update offline storage'));
  });
}
/** Atomic insert prevents double clicks and multiple tabs from replacing an answer. */
export async function addOffline<T>(key: string, value: T, limit?: {pendingPrefix:string;count:number}): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records");
    let result = value;
    let failure: Error | undefined;
    const get = store.get(key);
    get.onsuccess = () => {
      if (get.result) result = get.result.value;
      else if (limit) {
        const all = store.getAll(IDBKeyRange.bound(limit.pendingPrefix,limit.pendingPrefix+"\uffff"));
        all.onsuccess = ()=>{
          if (all.result.filter(row=>row.value.status==="pending").length >= limit.count) {
            failure = new Error("15 answers are waiting to sync. Connect before attempting more."); tx.abort();
          } else store.add({key,value});
        };
      } else store.add({ key, value });
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error("Could not save offline answer"));
  });
}
