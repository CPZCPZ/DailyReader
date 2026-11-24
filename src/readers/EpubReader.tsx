import { useEffect, useRef, useState } from 'react';
import type { Book, Rendition } from 'epubjs';
import type { HighlightColor } from '../types';
import type { ReaderProps } from './types';
import { resolveTheme, useSettings, type ReaderSettings } from '../store/useSettings';

const HL_FILL: Record<HighlightColor, string> = {
  yellow: '#fde047',
  green: '#86efac',
  blue: '#93c5fd',
  pink: '#f9a8d4',
};

function applyEpubTheme(r: Rendition, settings: ReaderSettings, dark: boolean) {
  const pad = 12 + settings.margin;
  r.themes.register('main', {
    body: {
      'font-size': `${settings.fontSize}px !important`,
      'line-height': String(settings.lineHeight) + ' !important',
      'font-family': settings.serif
        ? 'Georgia, "Noto Serif SC", serif !important'
        : 'inherit',
      background: dark ? '#1a202c !important' : '#ffffff !important',
      color: dark ? '#e2e8f0 !important' : '#1e293b !important',
      padding: `0 ${pad}px !important`,
    },
    p: {
      'text-indent': settings.indent ? '2em !important' : '0 !important',
    },
    'h1, h2, h3, h4': {
      'text-indent': '0 !important',
    },
    'a, a:link': {
      color: dark ? '#7dd3fc !important' : '#2563eb !important',
    },
  });
  r.themes.select('main');
}

interface TocNode {
  label?: string;
  href?: string;
  subitems?: TocNode[];
}

function flattenToc(items: TocNode[], out: { id: string; label: string; href: string }[] = []) {
  for (const item of items) {
    const label = item.label?.replace(/\s+/g, ' ').trim();
    if (label && item.href) {
      out.push({ id: `${item.href}-${out.length}`, label, href: item.href });
    }
    if (item.subitems?.length) flattenToc(item.subitems, out);
  }
  return out;
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
  highlights,
  jumpTo,
  onToc,
  onTextSelect,
  onSurfaceClick,
  onBindNav,
}: ReaderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const theme = useSettings((s) => s.theme);
  const cbRef = useRef(onProgress);
  cbRef.current = onProgress;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectRef = useRef(onTextSelect);
  selectRef.current = onTextSelect;
  const surfaceRef = useRef(onSurfaceClick);
  surfaceRef.current = onSurfaceClick;
  const navRef = useRef(onBindNav);
  navRef.current = onBindNav;
  const tocRef = useRef(onToc);
  tocRef.current = onToc;
  const percentRef = useRef(initialProgress?.percent ?? 0);
  const appliedRef = useRef<string[]>([]);
  const [readyTick, setReadyTick] = useState(0);

  useEffect(() => {
    let destroyed = false;
    let rendition: Rendition | null = null;
    const host = hostRef.current;
    if (!host) return;

    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    host.appendChild(container);

    (async () => {
      try {
        const ePub = (await import('epubjs')).default;
        if (destroyed) return;
        const book: Book = ePub(data);
        bookRef.current = book;
        rendition = book.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: settingsRef.current.epubFlow === 'scrolled' ? 'scrolled-doc' : 'paginated',
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
        navRef.current?.({
          prev: () => void rendition?.prev(),
          next: () => void rendition?.next(),
        });

        rendition.on('relocated', (loc: {
          start: { cfi: string; index: number; percentage?: number };
        }) => {
          const spine =
            book.spine as unknown as
              | { spineItems?: unknown[]; length?: number }
              | undefined;
          const spineLen = spine?.spineItems?.length ?? spine?.length ?? 1;
          const fallback = ((loc.start.index + 1) / Math.max(1, spineLen)) * 100;
          const percent =
            loc.start.percentage && loc.start.percentage > 0
              ? loc.start.percentage * 100
              : fallback;
          percentRef.current = Math.min(100, Math.max(0, percent));
          cbRef.current({
            type: 'cfi',
            value: loc.start.cfi,
            percent: percentRef.current,
          });
        });

        rendition.on('selected', (cfiRange: string, contents: {
          window: Window;
          document: Document;
        }) => {
          const selection = contents.window.getSelection();
          const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
          if (!text) return;
          const rect = selection?.rangeCount
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
          const iframe = contents.document.defaultView?.frameElement as HTMLIFrameElement | null;
          const frame = iframe?.getBoundingClientRect();
          selectRef.current?.({
            text: text.slice(0, 400),
            locator: {
              type: 'cfi',
              value: cfiRange,
              quote: text.slice(0, 400),
              percent: percentRef.current,
            },
            clientX: (frame?.left ?? 0) + (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
            clientY: (frame?.top ?? 0) + (rect?.top ?? 40),
          });
        });

        rendition.hooks.content.register((contents: {
          document: Document;
          window: Window;
        }) => {
          contents.document.addEventListener('click', (ev: Event) => {
            const mouse = ev as MouseEvent;
            const target = mouse.target as HTMLElement | null;
            if (target?.closest('a')) return;
            const selected = contents.window.getSelection()?.toString().trim() ?? '';
            if (selected) return;
            const width = contents.document.documentElement.clientWidth || 1;
            const x = mouse.clientX;
            if (x < width * 0.28) {
              mouse.preventDefault();
              void rendition?.prev();
            } else if (x > width * 0.72) {
              mouse.preventDefault();
              void rendition?.next();
            } else {
              surfaceRef.current?.('center');
            }
          });
        });

        const target =
          initialProgress?.type === 'cfi' ? String(initialProgress.value) : undefined;
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
          applyEpubTheme(
            rendition,
            settingsRef.current,
            resolveTheme(themeRef.current) === 'dark',
          );
          setReadyTick((n) => n + 1);
        }
        void book.loaded.navigation.then((nav) => {
          if (destroyed) return;
          const toc = (nav as { toc?: TocNode[] }).toc ?? [];
          tocRef.current?.(
            flattenToc(toc).map((item) => ({
              id: item.id,
              label: item.label,
              locator: { type: 'href', value: item.href },
            })),
          );
        });
      } catch (err) {
        console.error('EPUB 打开失败', err);
      }
    })().catch((err) => {
      console.error('EPUB 打开失败', err);
    });

    return () => {
      destroyed = true;
      renditionRef.current = null;
      bookRef.current = null;
      appliedRef.current = [];
      navRef.current?.(null);
      try {
        rendition?.destroy();
      } catch {
        /* ignore */
      }
      container.remove();
    };
    // 字号变化不重建；翻页方式变化必须重建 rendition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, settings.epubFlow]);

  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    applyEpubTheme(r, settings, resolveTheme(theme) === 'dark');
  }, [
    settings.fontSize,
    settings.lineHeight,
    settings.serif,
    settings.margin,
    settings.indent,
    theme,
    readyTick,
  ]);

  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    for (const cfi of appliedRef.current) {
      try {
        r.annotations.remove(cfi, 'highlight');
      } catch {
        /* ignore */
      }
    }
    appliedRef.current = [];
    for (const h of highlights ?? []) {
      if (h.deletedAt || h.locator.type !== 'cfi') continue;
      const cfi = String(h.locator.value);
      try {
        r.annotations.highlight(
          cfi,
          {},
          () => undefined,
          `hl-${h.color}`,
          { fill: HL_FILL[h.color], 'fill-opacity': '0.45' },
        );
        appliedRef.current.push(cfi);
      } catch {
        /* 还没渲染到该页时忽略，翻页后下次 effect 再画 */
      }
    }
  }, [highlights, readyTick]);

  useEffect(() => {
    const r = renditionRef.current;
    const book = bookRef.current;
    if (!r || !book || !jumpTo) return;
    const loc = jumpTo.locator;
    if (loc.type === 'cfi' || loc.type === 'href') {
      void r.display(String(loc.value));
      return;
    }
    if (loc.type === 'percent') {
      const spine = book.spine as unknown as { spineItems?: { href: string }[] };
      const items = spine.spineItems ?? [];
      if (!items.length) return;
      const idx = Math.min(
        items.length - 1,
        Math.max(0, Math.round((Number(loc.value) / 100) * (items.length - 1))),
      );
      void r.display(items[idx].href);
    }
  }, [jumpTo, readyTick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = renditionRef.current;
      if (!r) return;
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') void r.prev();
      if (e.key === 'ArrowRight') void r.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div ref={hostRef} className="h-full bg-white dark:bg-slate-800" />;
}
