import type { StorageAdapter } from "@multica/core/types/storage";

export const desktopStorage: StorageAdapter = {
  getItem: (key) => window.electronStore.get(key),
  setItem: (key, value) => window.electronStore.set(key, value),
  removeItem: (key) => window.electronStore.delete(key),
};
