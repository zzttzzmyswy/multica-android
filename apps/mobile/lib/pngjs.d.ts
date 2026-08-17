declare module "pngjs" {
  export interface PNGInfo {
    width: number;
    height: number;
    data: Buffer;
    colorType: number;
  }
  export interface PNG {
    width: number;
    height: number;
    data: Buffer;
    colorType: number;
  }
  export const PNG: {
    sync: { read(buffer: Buffer): PNGInfo };
  };
}