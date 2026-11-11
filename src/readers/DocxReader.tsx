import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ScrolledHtmlReader } from './ScrolledHtmlReader';
import { Loading } from './Loading';
import type { ReaderProps } from './types';

/** DOCX 阅读器：mammoth 转 HTML（图片内联为 dataURL），DOMPurify 清洗后滚动阅读 */
export default function DocxReader({
  data,
  initialProgress,
  settings,
  onProgress,
}: ReaderProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.convertToHtml({ arrayBuffer: data });
      if (cancelled) return;
      setHtml(
        DOMPurify.sanitize(result.value, {
          USE_PROFILES: { html: true },
        }),
      );
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setError('DOCX 解析失败：' + (err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-red-500">
        {error}
      </div>
    );
  }
  if (html === null) {
    return <Loading text="正在解析 DOCX…" />;
  }
  return (
    <ScrolledHtmlReader
      html={html}
      initialPercent={
        initialProgress?.type === 'percent' ? initialProgress.percent : undefined
      }
      settings={settings}
      onScrollPercent={(percent) =>
        onProgress({ type: 'percent', value: percent, percent })
      }
    />
  );
}
