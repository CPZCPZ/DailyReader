import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// GitHub Pages 部署在 https://<user>.github.io/<repo>/ 下，base 必须与仓库名一致。
// 本地开发或自定义域名时可用环境变量 BASE_PATH=/ 覆盖。
const repoName = process.env.BASE_PATH ?? '/DailyReader/';

// 版本号：npm version + 构建时间，注入前端用于设置页展示与远程排障
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };
const appVersion = `${pkg.version}@${new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .slice(0, 12)}`;

export default defineConfig({
  base: repoName,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'DailyReader',
        short_name: 'DailyReader',
        description: '跨平台同步阅读器，数据存在你自己的 GitHub 仓库里',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // 书籍数据在 IndexedDB 中，运行时无需缓存外部资源；字体等走浏览器默认缓存
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    // pdfjs/epubjs/web-ppt 体积可观，适当放宽告警阈值
    chunkSizeWarningLimit: 1600,
  },
  // mammoth 走 browser 字段；pdfjs 用 legacy 构建保证旧浏览器兼容
  optimizeDeps: {
    include: [
      'mammoth',
      'epubjs',
      'pdfjs-dist/legacy/build/pdf.min.mjs',
      'chardet',
      'markdown-it',
      'dompurify',
    ],
  },
});
