export interface SDKLogger {
  debug(msg: string, ...data: unknown[]): void;
  info(msg: string, ...data: unknown[]): void;
  warn(msg: string, ...data: unknown[]): void;
  error(msg: string, ...data: unknown[]): void;
}

export const noopLogger: SDKLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
