const DB_NAME = "acars-livery-cache";
const DB_VERSION = 2;
const STORE_NAME = "images";

function openImageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function closeImageDB(db: IDBDatabase) {
  try {
    db.close();
  } catch {
    // Ignore close failures
  }
}

export async function getCachedImage(key: string): Promise<Blob | null> {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => closeImageDB(db);
      tx.onabort = () => closeImageDB(db);
      tx.onerror = () => closeImageDB(db);
    });
  } catch {
    return null;
  }
}

export async function setCachedImage(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blob, key);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        closeImageDB(db);
        resolve();
      };
      tx.onabort = () => {
        closeImageDB(db);
        reject(tx.error);
      };
      tx.onerror = () => {
        closeImageDB(db);
        reject(tx.error);
      };
    });
  } catch (error) {
    console.warn("[Images] IndexedDB cache write failed:", error);
  }
}
