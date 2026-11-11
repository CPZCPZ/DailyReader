import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ScrolledHtmlReader } from './ScrolledHtmlReader';
import type { ReaderProps } from './types';
import { Loading } from './Loading';

/** Markdown 阅读器：markdown-it 渲染（支持内嵌 HTML，经 DOMPurify 清洗） */
export default function MdReader({
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
      const MarkdownIt = (await import('markdown-it')).default;
      const md = new MarkdownIt({ html: true, linkify: true });
      const text = new TextDecoder().decode(new Uint8Array(data));
      const raw = md.render(text);
      if (!cancelled)
        setHtml(DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }));
    })().catch((err) => {
      if (!cancelled) setError('Markdown 解析失败：' + (err as Error).message);
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
  if (html === null) return <Loading text="正在渲染 Markdown…" />;

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
