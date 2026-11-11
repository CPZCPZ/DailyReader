import type { BookFormat } from '../types';

export interface ImportExtras {
  title?: string;
  author?: string;
  cover?: string;
}

/** 超时保护：任何解析库卡死都不阻塞导入流程 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** 将图片 Blob 等比缩放为小体积 dataURL，控制 shelf.json 体积 */
async function blobToCoverDataUrl(
  blob: Blob,
  maxW = 300,
  maxH = 480,
): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas
    .getContext('2d')!
    .drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.75);
}

/**
 * 导入时提取标题/作者/封面。动态 import 避免把重解析库打进首屏 chunk。
 * 任何失败都不阻塞导入（返回空对象）。
 */
export async function extractImportExtras(
  data: ArrayBuffer,
  format: BookFormat,
): Promise<ImportExtras> {
  try {
    if (format === 'epub') {
      const ePub = (await import('epubjs')).default;
      const book = ePub(data);
      await withTimeout(book.ready, 15000, undefined as unknown as void);
      const meta = book.packaging?.metadata;
      let cover: string | undefined;
      try {
        const url = await withTimeout(
          book.coverUrl(),
          8000,
          null as unknown as string | null,
        );
        if (url) {
          const blob = await (await fetch(url)).blob();
          if (blob.size > 0) cover = await blobToCoverDataUrl(blob);
        }
      } catch {
        /* 无封面 */
      }
      const extras: ImportExtras = {
        title: meta?.title || undefined,
        author: meta?.creator || undefined,
        cover,
      };
      try {
        book.destroy();
      } catch {
        /* ignore */
      }
      return extras;
    }
    if (format === 'pdf') {
      // legacy 构建：内置 Map/WeakMap 新 API 的 polyfill，兼容更多浏览器
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
      const workerUrl = (
        await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await withTimeout(
        pdfjs.getDocument({ data: data.slice(0) }).promise,
        15000,
        null as unknown as Awaited<
          ReturnType<typeof pdfjs.getDocument>['promise']
        >,
      );
      if (!doc) return {};
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(300 / base.width, 480 / base.height, 2);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({
        canvas,
        viewport,
      }).promise;
      const cover = canvas.toDataURL('image/jpeg', 0.75);
      doc.destroy();
      return { cover };
    }
  } catch (err) {
    console.warn('提取封面/元数据失败（不影响导入）', err);
  }
  return {};
}
