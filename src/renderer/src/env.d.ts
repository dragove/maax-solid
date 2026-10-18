/// <reference types="vite/client" />

import type { MaaxBridge } from "../../shared/ipc";

declare global {
  interface Window {
    readonly maax: MaaxBridge;
  }

  const __MAAX_BUILD__: {
    readonly hostNode: string;
    readonly pnpm: string;
    readonly vite: string;
    readonly electron: string;
    readonly solid: string;
    readonly effect: string;
    readonly typescript: string;
  };
}

export {};
