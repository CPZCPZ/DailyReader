import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReaderProps } from './types';

/**
 * PDF 阅读器（pdf.js）：单页视图 + 文字层可选中划线。
 * 进度：页码。翻页由外层底栏和左右点击区触发。
 */
export default function PdfReader({
  data,
  initialProgress,
  onProgress,
  highlights,
  jumpTo,
  onToc,
  onTextSelect,
  onSurfaceClick,
  onBindNav,
}: ReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
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
  const selectRef = useRef(onTextSelect);
  selectRef.current = onTextSelect;
  const surfaceRef = useRef(onSurfaceClick);
  surfaceRef.current = onSurfaceClick;
  const navBindRef = useRef(onBindNav);
  navBindRef.current = onBindNav;
  const tocRef = useRef(onToc);
  tocRef.current = onToc;

  useEffect(() => {
    if (numPages > 0) {
      cbRef.current({
        type: 'page',
        value: page,
        percent: (page / numPages) * 100,
      });
    }
  }, [page, numPages]);

  useEffect(() => {
    if (!numPages) return;
    const items = [];
    const step = numPages > 80 ? Math.ceil(numPages / 40) : 1;
    for (let i = 1; i <= numPages; i += step) {
      items.push({
        id: `p${i}`,
        label: `第 ${i} 页`,
        locator: { type: 'page' as const, value: i, percent: (i / numPages) * 100 },
      });
    }
    if (items[items.length - 1]?.id !== `p${numPages}`) {
      items.push({
        id: `p${numPages}`,
        label: `第 ${numPages} 页`,
        locator: { type: 'page' as const, value: numPages, percent: 100 },
      });
    }
    tocRef.current?.(items);
  }, [numPages]);

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
    const box = pageBoxRef.current;
    const textLayer = textLayerRef.current;
    if (!doc || !canvas || !box || !textLayer) return;
    setRendering(true);
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
      const pdfPage = await doc.getPage(pageNum);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = box.clientWidth || 320;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = cssWidth / base.width;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr });
      const cssViewport = pdfPage.getViewport({ scale: cssScale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvas, viewport });
      renderTaskRef.current = task;
      await task.promise;

      textLayer.replaceChildren();
      textLayer.style.width = `${cssViewport.width}px`;
      textLayer.style.height = `${cssViewport.height}px`;
      const textContent = await pdfPage.getTextContent();
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;
        const tx = pdfjs.Util.transform(cssViewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || item.height * cssScale;
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.fontFamily = 'sans-serif';
        textLayer.appendChild(span);
      }
    } catch (err) {
      const name = (err as Error)?.name;
      if (name !== 'RenderingCancelledException') console.error(err);
    } finally {
      setRendering(false);
    }
  }, []);

  useEffect(() => {
    if (numPages > 0) void renderPage(page);
  }, [page, numPages, renderPage]);

  useEffect(() => {
    const onResize = () => {
      if (numPages > 0) void renderPage(page);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [page, numPages, renderPage]);

  useEffect(() => {
    if (!jumpTo || !numPages) return;
    const loc = jumpTo.locator;
    if (loc.type === 'page') {
      setPage(Math.min(numPages, Math.max(1, Number(loc.value) || 1)));
    } else if (loc.type === 'percent') {
      const target = Math.round((Number(loc.value) / 100) * numPages) || 1;
      setPage(Math.min(numPages, Math.max(1, target)));
    }
  }, [jumpTo, numPages]);

  useEffect(() => {
    navBindRef.current?.({
      prev: () => setPage((p) => Math.max(1, p - 1)),
      next: () => setPage((p) => (numPages ? Math.min(numPages, p + 1) : p)),
    });
    return () => navBindRef.current?.(null);
  }, [numPages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
      if (e.key === 'ArrowRight') setPage((p) => (numPages ? Math.min(numPages, p + 1) : p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages]);

  const pageHighlights = (highlights ?? []).filter(
    (h) => !h.deletedAt && h.locator.type === 'page' && Number(h.locator.value) === page,
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full overflow-auto bg-slate-100 p-3 dark:bg-slate-900 sm:p-6">
      <div ref={pageBoxRef} className="relative mx-auto w-full max-w-3xl">
        <canvas ref={canvasRef} className="block w-full rounded shadow-lg" />
        <div className="pointer-events-none absolute inset-0">
          {pageHighlights.map((h) =>
            (h.rects ?? []).map((rect, i) => (
              <div
                key={`${h.id}-${i}`}
                className={`absolute hl-pdf hl-${h.color}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
                title={h.note || h.text}
              />
            )),
          )}
        </div>
        <div
          ref={textLayerRef}
          className="pdf-text-layer"
          onMouseUp={() => {
            const sel = window.getSelection();
            const box = pageBoxRef.current;
            if (!sel || sel.isCollapsed || !box) return;
            const text = sel.toString().replace(/\s+/g, ' ').trim();
            if (!text) return;
            const range = sel.getRangeAt(0);
            const boxRect = box.getBoundingClientRect();
            const rects = [...range.getClientRects()]
              .map((r) => ({
                x: (r.left - boxRect.left) / boxRect.width,
                y: (r.top - boxRect.top) / boxRect.height,
                w: r.width / boxRect.width,
                h: r.height / boxRect.height,
              }))
              .filter((r) => r.w > 0.002 && r.h > 0.002);
            const anchor = rects[0];
            selectRef.current?.({
              text: text.slice(0, 400),
              locator: {
                type: 'page',
                value: page,
                percent: numPages ? (page / numPages) * 100 : 0,
                quote: text.slice(0, 400),
              },
              rects,
              clientX: anchor ? boxRect.left + anchor.x * boxRect.width : boxRect.left,
              clientY: anchor ? boxRect.top + anchor.y * boxRect.height : boxRect.top,
            });
          }}
          onClick={(e) => {
            if (window.getSelection()?.toString().trim()) return;
            const box = pageBoxRef.current?.getBoundingClientRect();
            if (!box) return;
            const x = (e.clientX - box.left) / box.width;
            if (x < 0.25) setPage((p) => Math.max(1, p - 1));
            else if (x > 0.75) setPage((p) => (numPages ? Math.min(numPages, p + 1) : p));
            else surfaceRef.current?.('center');
          }}
        />
        {rendering && (
          <div className="absolute right-3 top-3 rounded-full bg-slate-900/70 px-3 py-1 text-xs text-white">
            渲染中…
          </div>
        )}
      </div>
    </div>
  );
}
