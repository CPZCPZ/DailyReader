import { useEffect, useRef, memo } from 'react';
import type { ReaderSettings } from '../store/useSettings';
import type { Highlight } from '../types';
import type { TextSelectionInfo, TocEntry } from './types';
import { clearMarks, contextAround, findQuoteRange, wrapQuote } from './textLocate';

interface Props {
  /** 已经过 DOMPurify 清洗的 HTML 字符串 */
  html: string;
  initialPercent?: number;
  settings: ReaderSettings;
  onScrollPercent: (percent: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  highlights?: Highlight[];
  jumpTo?: { nonce: number; locator: { type: string; value: string | number; quote?: string; prefix?: string } } | null;
  onToc?: (items: TocEntry[]) => void;
  onTextSelect?: (sel: TextSelectionInfo | null) => void;
  onSurfaceClick?: (zone: 'center') => void;
}

/**
 * 通用滚动阅读视图：docx / md / txt / html 共用。
 * 进度 = 滚动百分比（节流上报），恢复 = 按百分比定位。
 * 划线按摘录重新包 mark，不依赖会漂的百分比。
 */
export const ScrolledHtmlReader = memo(function ScrolledHtmlReader({
  html,
  initialPercent,
  settings,
  onScrollPercent,
  containerRef,
  highlights,
  jumpTo,
  onToc,
  onTextSelect,
  onSurfaceClick,
}: Props) {
  const ownRef = useRef<HTMLDivElement>(null);
  const scrollRef = containerRef ?? ownRef;
  const restoredRef = useRef(false);
  const lastReportRef = useRef(0);
  const cbRef = useRef(onScrollPercent);
  cbRef.current = onScrollPercent;
  const percentRef = useRef(initialPercent ?? 0);
  const selectRef = useRef(onTextSelect);
  selectRef.current = onTextSelect;
  const surfaceRef = useRef(onSurfaceClick);
  surfaceRef.current = onSurfaceClick;

  useEffect(() => {
    if (restoredRef.current) return;
    if (initialPercent === undefined || !scrollRef.current) return;
    const el = scrollRef.current;
    const raf = requestAnimationFrame(() => {
      const denom = el.scrollHeight - el.clientHeight;
      el.scrollTop = denom > 0 ? (initialPercent / 100) * denom : 0;
      restoredRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [html, initialPercent, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const report = () => {
      const denom = el.scrollHeight - el.clientHeight;
      const percent = denom > 0 ? (el.scrollTop / denom) * 100 : 0;
      percentRef.current = percent;
      cbRef.current(Math.min(100, Math.max(0, percent)));
    };
    const first = requestAnimationFrame(report);
    const onScroll = () => {
      const now = performance.now();
      if (now - lastReportRef.current < 1500) return;
      lastReportRef.current = now;
      report();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      el.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef, html]);

  useEffect(() => {
    const root = scrollRef.current?.querySelector('article');
    if (!root) return;
    const headings = [...root.querySelectorAll('h1, h2, h3')];
    const items: TocEntry[] = headings.map((node, i) => {
      const label = (node.textContent ?? '').trim() || `小节 ${i + 1}`;
      if (!node.id) node.id = `toc-${i}`;
      return {
        id: node.id,
        label,
        locator: { type: 'percent', value: 0, quote: label },
      };
    });
    onToc?.(items);
  }, [html, onToc, scrollRef]);

  useEffect(() => {
    const root = scrollRef.current?.querySelector('article');
    if (!root) return;
    const el = scrollRef.current;
    const top = el?.scrollTop ?? 0;
    clearMarks(root);
    for (const h of highlights ?? []) {
      if (h.deletedAt || !h.locator.quote) continue;
      wrapQuote(root, h.locator.quote, h.locator.prefix, {
        id: h.id,
        className: `hl hl-${h.color}`,
        title: h.note,
      });
    }
    if (el) el.scrollTop = top;
  }, [html, highlights, scrollRef]);

  useEffect(() => {
    if (!jumpTo) return;
    const root = scrollRef.current?.querySelector('article');
    const el = scrollRef.current;
    if (!root || !el) return;
    const quote = jumpTo.locator.quote;
    if (quote) {
      const range = findQuoteRange(root, quote, jumpTo.locator.prefix);
      if (range) {
        const mark = range.startContainer.parentElement;
        (mark ?? range.startContainer.parentElement)?.scrollIntoView({ block: 'center' });
        return;
      }
    }
    if (jumpTo.locator.type === 'percent') {
      const denom = el.scrollHeight - el.clientHeight;
      el.scrollTop = denom > 0 ? (Number(jumpTo.locator.value) / 100) * denom : 0;
    }
  }, [jumpTo, scrollRef, html]);

  function handleMouseUp() {
    const root = scrollRef.current?.querySelector('article');
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) {
      return;
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 400) return;
    const range = sel.getRangeAt(0);
    const { prefix, suffix } = contextAround(root, range);
    const rect = range.getBoundingClientRect();
    selectRef.current?.({
      text,
      locator: {
        type: 'percent',
        value: percentRef.current,
        percent: percentRef.current,
        quote: text,
        prefix,
        suffix,
      },
      clientX: rect.left + rect.width / 2,
      clientY: rect.top,
    });
  }

  return (
    <div
      ref={scrollRef}
      className="reader-scroll h-full overflow-y-auto"
      onMouseUp={handleMouseUp}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button, mark')) return;
        if (window.getSelection()?.toString().trim()) return;
        surfaceRef.current?.('center');
      }}
    >
      <article
        className={`reader-prose mx-auto py-8 pb-24 ${settings.indent ? 'reader-indent' : ''}`}
        style={{
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
          fontFamily: settings.serif
            ? 'Georgia, "Noto Serif SC", serif'
            : 'inherit',
          paddingLeft: `${20 + settings.margin}px`,
          paddingRight: `${20 + settings.margin}px`,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
