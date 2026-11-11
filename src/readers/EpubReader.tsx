import { useEffect, useRef } from 'react';
import type { Book, Rendition } from 'epubjs';
import type { ReaderProps } from './types';
import { resolveTheme, useSettings, type ReaderSettings } from '../store/useSettings';

function applyEpubTheme(  r: Rendition,
  settings: ReaderSettings,
  dark: boolean,
) {
  r.themes.register('main', {
    body: {
      'font-size': `${settings.fontSize}px !important`,
      'line-height': String(settings.lineHeight) + ' !important',
      'font-family': settings.serif
        ? 'Georgia, "Noto Serif SC", serif !important'
        : 'inherit',
      background: dark ? '#1a202c !important' : '#ffffff !important',
      color: dark ? '#e2e8f0 !important' : '#1e293b !important',
      padding: '0 14px !important',
    },
    'a, a:link': {
      color: dark ? '#7dd3fc !important' : '#2563eb !important',
    },
  });
  r.themes.select('main');
}

/**
 * EPUB 阅读器（epub.js）。
 * 进度：CFI（精确到字符位置），百分比用 spine 序号近似展示。
 *
 * 实现说明：StrictMode/快速重挂载下 epub.js 的 destroy() 若发生在 display()
 * 进行中会使 promise 悬挂，因此每个 effect 创建独立的容器 div，cleanup 时
 * 先标记 destroyed、销毁 rendition 再移除容器，任何 await 之后都复查标记。
 */
export default function EpubReader({
  data,
  initialProgress,
  settings,
  onProgress,
}: ReaderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const theme = useSettings((s) => s.theme);
  const cbRef = useRef(onProgress);
  cbRef.current = onProgress;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // 初始化 rendition
  useEffect(() => {
    let destroyed = false;
    let rendition: Rendition | null = null;
    const host = hostRef.current;
    if (!host) return;

    // 本 effect 私有容器：避免上一次挂载的残留/竞态
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    host.appendChild(container);

    (async () => {
      try {
        const ePub = (await import('epubjs')).default;
        if (destroyed) return;
        const book: Book = ePub(data);
        rendition = book.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          allowScriptedContent: false,
        });
      if (destroyed) {
        try {
          rendition.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      renditionRef.current = rendition;

      rendition.on('relocated', (loc: {
        start: { cfi: string; index: number; percentage?: number };
      }) => {
        const spine =
          book.spine as unknown as
          | { spineItems?: unknown[]; length?: number }
          | undefined;
        const spineLen = spine?.spineItems?.length ?? spine?.length ?? 1;
        const percent =
          loc.start.percentage !== undefined
            ? loc.start.percentage * 100
            : ((loc.start.index + 1) / Math.max(1, spineLen)) * 100;
        cbRef.current({
          type: 'cfi',
          value: loc.start.cfi,
          percent: Math.min(100, Math.max(0, percent)),
        });
      });

      const target =
        initialProgress?.type === 'cfi'
          ? String(initialProgress.value)
          : undefined;
      // epub.js 已知怪癖：带 CFI 首次 display 可能永不 resolve。
      // 稳妥顺序：先显示首页，再定位 CFI，失败回退首页。
      await rendition.display();
      if (target && !destroyed) {
        try {
          await Promise.race([
            rendition.display(target),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('cfi-timeout')), 5000),
            ),
          ]);
        } catch {
          await rendition.display().catch(() => undefined);
        }
      }
      if (!destroyed) {
        applyEpubTheme(rendition, settings, resolveTheme(themeRef.current) === 'dark');
      }
      } catch (err) {
        console.error('EPUB 打开失败', err);
      }
    })().catch((err) => {
      console.error('EPUB 打开失败', err);
    });

    return () => {
      destroyed = true;
      renditionRef.current = null;
      try {
        rendition?.destroy();
      } catch {
        /* ignore */
      }
      container.remove();
    };
    // 仅 data 变化才重建；进度/主题变化在下方单独处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 字号/字体/主题 → 通过 epub.js themes 实时应用
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    applyEpubTheme(r, settings, resolveTheme(theme) === 'dark');
  }, [settings.fontSize, settings.lineHeight, settings.serif, theme, data]);

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = renditionRef.current;
      if (!r) return;
      if (e.key === 'ArrowLeft') void r.prev();
      if (e.key === 'ArrowRight') void r.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="group relative h-full bg-white dark:bg-slate-800">
      <div ref={hostRef} className="h-full" />
      <div className="absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex gap-1 rounded-full border border-slate-200 bg-white/95 px-2 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
          <button
            className="rounded-full px-3 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => void renditionRef.current?.prev()}
            aria-label="上一页"
          >
            ←
          </button>
          <button
            className="rounded-full px-3 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => void renditionRef.current?.next()}
            aria-label="下一页"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
