import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ScrolledHtmlReader } from './ScrolledHtmlReader';
import type { ReaderProps } from './types';
import { Loading } from './Loading';

/** HTML 阅读器：解析完整文档取 body，DOMPurify 清洗后滚动阅读 */
export default function HtmlReader({
  data,
  initialProgress,
  settings,
  onProgress,
}: ReaderProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const text = new TextDecoder().decode(new Uint8Array(data));
      const doc = new DOMParser().parseFromString(text, 'text/html');
      doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
      const body = doc.body?.innerHTML ?? text;
      setHtml(
        DOMPurify.sanitize(body, {
          USE_PROFILES: { html: true },
          ALLOWED_URI_REGEXP: /^(?:(?:https?|data|blob):|[^:#]*$)/i,
        }),
      );
    } catch (err) {
      setError('HTML 解析失败：' + (err as Error).message);
    }
  }, [data]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-red-500">
        {error}
      </div>
    );
  }
  if (html === null) return <Loading text="正在解析 HTML…" />;

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
