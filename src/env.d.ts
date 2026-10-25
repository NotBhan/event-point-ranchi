/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    auth: import('./core/types').AuthState;
    csrf: string;
    flash: import('./core/types').FlashMessage | null;
  }
}

declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly APP_SECRET?: string;
  readonly DATA_DIR?: string;
  readonly DISABLED_MODULES?: string;
  readonly COOKIE_SECURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
