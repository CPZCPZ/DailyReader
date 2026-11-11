import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderProps } from './types';

/**
 * PDF 阅读器（pdf.js）：单页视图 + 翻页/跳页，按容器宽度自适应。
 * 进度：页码。
 */
export default function PdfReader({
  data,
  initialProgress,
  onProgress,
}: ReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(
    initialProgress?.type === 'page' ? Number(initialProgress.value) || 1 : 1,
  );
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cbRef = useRef(onProgress);
  cbRef.current = onProgress;

  // 上报当前页进度
  useEffect(() => {
    if (numPages > 0) {
      cbRef.current({
        type: 'page',
        value: page,
        percent: (page / numPages) * 100,
      });
    }
  }, [page, numPages]);

  // 加载文档（legacy 构建：含新 JS API 的 polyfill，兼容更多浏览器）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
      const workerUrl = (
        await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
      if (cancelled) {
        void doc.destroy();
        return;
      }
      docRef.current = doc;
      setNumPages(doc.numPages);
    })().catch((err) => {
      console.error(err);
      setError('PDF 打开失败：' + (err as Error).message);
      setRendering(false);
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [data]);

  const renderPage = useCallback(async (pageNum: number) => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!doc || !canvas || !wrap) return;
    setRendering(true);
    try {
      const pdfPage = await doc.getPage(pageNum);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = wrap.clientWidth;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (cssWidth / base.width) * dpr;
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({
        canvas,
        viewport,
      });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err) {
      const name = (err as Error)?.name;
      if (name !== 'RenderingCancelledException') {
        console.error(err);
      }
    } finally {
      setRendering(false);
    }
  }, []);

  useEffect(() => {
    if (numPages > 0) void renderPage(page);
  }, [page, numPages, renderPage]);

  // 窗口尺寸变化 → 重绘当前页
  useEffect(() => {
    const onResize = () => {
      if (numPages > 0) void renderPage(page);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [page, numPages, renderPage]);

  const go = useCallback(
    (n: number) => {
      setPage(() => Math.min(numPages, Math.max(1, n)));
    },
    [numPages],
  );

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      )
        return;
      if (e.key === 'ArrowLeft') go(page - 1);
      if (e.key === 'ArrowRight') go(page + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, page]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-100 dark:bg-slate-900">
      <div ref={wrapRef} className="relative flex-1 overflow-auto p-3 sm:p-6">
        <canvas
          ref={canvasRef}
          className="mx-auto block max-w-3xl rounded shadow-lg"
        />
        {rendering && (
          <div className="absolute right-4 top-4 rounded-full bg-slate-900/70 px-3 py-1 text-xs text-white">
            渲染中…
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
        <button
          className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
        >
          ← 上一页
        </button>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          <input
            type="number"
            value={page}
            min={1}
            max={numPages}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= numPages) setPage(v);
            }}
            className="w-14 rounded border border-slate-300 bg-transparent px-2 py-0.5 text-center dark:border-slate-600"
          />
          {' '}
          / {numPages || '…'}
        </span>
        <button
          className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={() => go(page + 1)}
          disabled={numPages > 0 && page >= numPages}
        >
          下一页 →
        </button>
      </div>
    </div>
  );
}
