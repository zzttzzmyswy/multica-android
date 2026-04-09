import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import Store from "electron-store";

const store = new Store<Record<string, string>>({
  name: "multica-desktop",
});

const electronStore = {
  get: (key: string): string | null => store.get(key) ?? null,
  set: (key: string, value: string): void => store.set(key, value),
  delete: (key: string): void => store.delete(key),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("electronStore", electronStore);
} else {
  // @ts-expect-error - fallback for non-isolated context
  window.electron = electronAPI;
  // @ts-expect-error - fallback for non-isolated context
  window.electronStore = electronStore;
}
