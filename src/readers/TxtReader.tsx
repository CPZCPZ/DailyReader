import { useEffect, useState } from 'react';
import chardet from 'chardet';
import DOMPurify from 'dompurify';
import { ScrolledHtmlReader } from './ScrolledHtmlReader';
import type { ReaderProps } from './types';
import { Loading } from './Loading';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 解码 TXT：chardet 检测编码（GBK/GB18030/Big5/UTF-8/Shift_JIS…），
 * 检测失败或浏览器不支持该编码时回退 UTF-8。
 */
export function decodeText(bytes: Uint8Array): string {
  let encoding: string | null = null;
  try {
    encoding = chardet.detect(bytes);
  } catch {
    encoding = null;
  }
  const candidates = [encoding, 'utf-8'].filter(Boolean) as string[];
  for (const enc of candidates) {
    try {
      const decoded = new TextDecoder(enc, { fatal: true }).decode(bytes);
      if (!decoded.includes('\uFFFD')) return decoded;
    } catch {
      /* 该编码不可用或不匹配，尝试下一个 */
    }
  }
  // 最终回退：宽松 UTF-8
  return new TextDecoder().decode(bytes);
}

/** TXT 阅读器：编码检测 + 段落化滚动阅读 */
export default function TxtReader({
  data,
  initialProgress,
  settings,
  onProgress,
}: ReaderProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    const bytes = new Uint8Array(data);
    const text = decodeText(bytes).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p).replaceAll('\n', '<br/>')}</p>`)
      .join('\n');
    setHtml(DOMPurify.sanitize(paragraphs));
  }, [data]);

  if (html === null) return <Loading text="正在解码文本…" />;

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
