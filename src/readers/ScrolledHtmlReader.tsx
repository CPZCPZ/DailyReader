import { useEffect, useRef, memo } from 'react';
import type { ReaderSettings } from '../store/useSettings';

interface Props {
  /** 已经过 DOMPurify 清洗的 HTML 字符串 */
  html: string;
  initialPercent?: number;
  settings: ReaderSettings;
  onScrollPercent: (percent: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * 通用滚动阅读视图：docx / md / txt / html 共用。
 * 进度 = 滚动百分比（节流上报），恢复 = 按百分比定位。
 */
export const ScrolledHtmlReader = memo(function ScrolledHtmlReader({
  html,
  initialPercent,
  settings,
  onScrollPercent,
  containerRef,
}: Props) {
  const ownRef = useRef<HTMLDivElement>(null);
  const scrollRef = containerRef ?? ownRef;
  const restoredRef = useRef(false);
  const lastReportRef = useRef(0);
  const cbRef = useRef(onScrollPercent);
  cbRef.current = onScrollPercent;

  // 内容变化后恢复上次进度（等待布局完成）
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

  // 滚动 → 节流上报百分比
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const now = performance.now();
      if (now - lastReportRef.current < 1500) return;
      lastReportRef.current = now;
      const denom = el.scrollHeight - el.clientHeight;
      const percent = denom > 0 ? (el.scrollTop / denom) * 100 : 0;
      cbRef.current(Math.min(100, Math.max(0, percent)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  return (
    <div
      ref={scrollRef}
      className="reader-scroll h-full overflow-y-auto"
    >
      <article
        className="reader-prose mx-auto px-5 py-8 pb-24 sm:px-8"
        style={{
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
          fontFamily: settings.serif
            ? 'Georgia, "Noto Serif SC", serif'
            : 'inherit',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
