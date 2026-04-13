import { ElectronAPI } from "@electron-toolkit/preload";

interface UpdaterAPI {
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    updater: UpdaterAPI;
  }
}

export {};
