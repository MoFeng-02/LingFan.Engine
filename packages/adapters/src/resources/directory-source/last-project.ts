/**
 * 「记住上次工程」：把目录句柄存进 IndexedDB，下次打开免选择。
 * 句柄不可序列化但有结构化的存取语义（IndexedDB 原生支持 `FileSystemHandle`），
 * 存取两侧都要做形状校验与尽力而为的错误吞并：本模块**绝不**因持久化失败
 * 而阻断打开流程，取不到就当没存过。
 */
import type { LastProjectHandleStore } from "@lingfan/engine";

/** IndexedDB 数据库名 */
const LAST_PROJECT_DB = "lingfan-editor";
/** IndexedDB 对象仓库名 */
const LAST_PROJECT_STORE = "last-project";
/** 句柄记录键（库内仅此一条记录） */
const LAST_PROJECT_KEY = "last";

/**
 * 存储里取回的值未必仍是目录句柄（版本迁移 / 外部写入 / 平台不支持句柄持久化），
 * 用结构校验挡住：形状不符即当没存过。这是**唯一**的句柄形状校验点。
 */
function isDirectoryHandleLike(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "directory"
  );
}

/**
 * 造一个「上次工程」句柄存储：句柄存进 IndexedDB（目录句柄不可序列化，但 IndexedDB 能原样存取）。
 * 读写全程尽力而为——IndexedDB 不可用、事务失败、被阻塞都只是「当没存过」，绝不阻断打开流程；
 * 取回的值必须过形状校验（见 `isDirectoryHandleLike`）才当作可用句柄。
 * `idbFactory` 可注入以便测试。
 */
export function createLastProjectStore(
  idbFactory?: IDBFactory,
): LastProjectHandleStore {
  const factory =
    idbFactory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);

  function openDb(): Promise<IDBDatabase | undefined> {
    if (factory === undefined) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      try {
        const request = factory.open(LAST_PROJECT_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LAST_PROJECT_STORE)) {
            db.createObjectStore(LAST_PROJECT_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  return {
    async load() {
      const db = await openDb();
      if (db === undefined) return undefined;
      try {
        return await new Promise((resolve) => {
          try {
            const request = db
              .transaction(LAST_PROJECT_STORE, "readonly")
              .objectStore(LAST_PROJECT_STORE)
              .get(LAST_PROJECT_KEY);
            request.onsuccess = () => {
              const value = request.result as unknown;
              resolve(isDirectoryHandleLike(value) ? value : undefined);
            };
            request.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        });
      } finally {
        db.close();
      }
    },
    async save(handle) {
      const db = await openDb();
      if (db === undefined) return;
      try {
        await new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(LAST_PROJECT_STORE, "readwrite");
            tx.objectStore(LAST_PROJECT_STORE).put(handle, LAST_PROJECT_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        });
      } finally {
        db.close();
      }
    },
  };
}
