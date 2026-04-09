import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    electronStore: {
      get(key: string): string | null;
      set(key: string, value: string): void;
      delete(key: string): void;
    };
  }
}

export {};
