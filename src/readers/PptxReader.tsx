import { useEffect, useRef, useState } from 'react';
import type { ReaderProps } from './types';
import { Loading } from './Loading';

interface SlideState {
  urls: string[];
  total: number;
}

/**
 * PPTX / PPT 阅读器（@web-ppt/core，koodo-reader 同款）。
 * 逐页渲染为 SVG，纵向滚动；进度 = 幻灯片序号（IntersectionObserver 观测最可见页）。
 */
export default function PptxReader({
  data,
  bookId,
  initialProgress,
  onProgress,
}: ReaderProps) {
  const [state, setState] = useState<SlideState>({ urls: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cbRef = useRef(onProgress);
  cbRef.current = onProgress;
  const restoredRef = useRef(false);

  // 解析并渲染
  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    (async () => {
      const { parse, slideToSvgFile } = await import('@web-ppt/core');
      const file = new File([data], `${bookId}.pptx`);
      const pres = await parse(file);
      const total = pres.slides.length;
      setState({ urls: [], total });
      for (let i = 0; i < total; i++) {
        // slideToSvgFile 返回自包含 SVG 字符串
        const svg = await slideToSvgFile(pres, pres.slides[i]);
        if (cancelled) return;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        urls.push(URL.createObjectURL(blob));
        setState({ urls: [...urls], total });
      }
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setError('PPT 解析失败：' + (err as Error).message);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 进度观测：最可见的幻灯片
  useEffect(() => {
    if (state.urls.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null;
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.index);
          if (!best || e.intersectionRatio > best.ratio) {
            best = { index: idx, ratio: e.intersectionRatio };
          }
        }
        if (best) {
          cbRef.current({
            type: 'slide',
            value: best.index + 1,
            percent: ((best.index + 1) / state.total) * 100,
          });
        }
      },
      { root: scrollRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [state.urls, state.total]);

  // 恢复进度：滚动到上次看到的幻灯片
  useEffect(() => {
    if (restoredRef.current || state.urls.length === 0) return;
    if (initialProgress?.type !== 'slide') {
      restoredRef.current = true;
      return;
    }
    const idx = Math.max(0, Number(initialProgress.value) - 1);
    const el = slideRefs.current[Math.min(idx, slideRefs.current.length - 1)];
    if (el) el.scrollIntoView();
    restoredRef.current = true;
  }, [state.urls, initialProgress]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-red-500">
        {error}
      </div>
    );
  }
  if (state.total === 0) return <Loading text="正在解析 PPT…" />;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-slate-100 p-3 dark:bg-slate-900 sm:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-10">
        {state.urls.map((url, i) => (
          <div
            key={i}
            data-index={i}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            className="overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-200 dark:ring-slate-700"
          >
            <img src={url} alt={`幻灯片 ${i + 1}`} className="block w-full" />
          </div>
        ))}
        {state.urls.length < state.total && (
          <p className="text-center text-sm text-slate-400">
            正在渲染… {state.urls.length}/{state.total}
          </p>
        )}
      </div>
    </div>
  );
}
