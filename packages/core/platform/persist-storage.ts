import type { StateStorage } from "zustand/middleware";
import type { StorageAdapter } from "../types/storage";

export function createPersistStorage(
  adapter: StorageAdapter,
  wsId?: string,
): StateStorage {
  const resolve = (key: string) => (wsId ? `${key}:${wsId}` : key);
  return {
    getItem: (key) => adapter.getItem(resolve(key)),
    setItem: (key, value) => adapter.setItem(resolve(key), value),
    removeItem: (key) => adapter.removeItem(resolve(key)),
  };
}
