/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时注入的版本号（vite.config.ts define） */
declare const __APP_VERSION__: string;

declare module '*?url' {
  const src: string;
  export default src;
}

/** pdfjs legacy 构建与主包 API 一致，复用其类型 */
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' {
  const src: string;
  export default src;
}
