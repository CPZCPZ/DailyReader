import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

// PWA Service Worker（vite-plugin-pwa 自动更新）
import('virtual:pwa-register').then(({ registerSW }) => {
  registerSW({
    immediate: false,
    // autoUpdate 下新 SW 装好后当前页面仍跑旧代码，打标记让书架页提示刷新
    onNeedRefresh() {
      try {
        localStorage.setItem('dr-sw-pending', '1');
        window.dispatchEvent(new Event('dr-sw-pending'));
      } catch {
        /* ignore */
      }
    },
  });
});
