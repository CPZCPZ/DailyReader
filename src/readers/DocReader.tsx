import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ScrolledHtmlReader } from './ScrolledHtmlReader';
import { extractDocText } from './docExtract';
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
 * .doc 阅读器（Word 97-2003）：
 * - 实为 zip/docx 的伪装 .doc → 交给 mammoth
 * - 真 Word97 二进制 → piece table 提取纯文本（带提示横幅）
 * 完整无损渲染见 Phase 4 服务端 LibreOffice。
 */
export default function DocReader(props: ReaderProps) {
  const { data, initialProgress, settings, onProgress } = props;
  const [kind, setKind] = useState<'loading' | 'docx' | 'text' | 'rtf' | 'error'>(
    'loading',
  );
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const head = new Uint8Array(data.slice(0, 8));
      const magic = String.fromCharCode(...head);
      if (magic.startsWith('PK')) {
        // 实际是 docx
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: data });
        if (cancelled) return;
        setKind('docx');
        setHtml(
          DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }),
        );
        return;
      }
      if (magic.startsWith('{\\rtf')) {
        setKind('rtf');
        setError('这是 RTF 文件：请改名为 .md/txt 前先转存为 .docx（Word/WPS 另存为）');
        return;
      }
      // Word97 OLE 二进制（magic D0 CF 11 E0）
      const text = extractDocText(data);
      if (cancelled) return;
      const paragraphs = text
        .split('\n')
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('\n');
      setKind('text');
      setHtml(
        DOMPurify.sanitize(
          `<div class="doc-notice">旧版 .doc 仅提取纯文本（格式与图片丢失）。完整体验请转存为 .docx。</div>${paragraphs}`,
        ),
      );
    })().catch((err) => {
      if (!cancelled) {
        setKind('error');
        setError((err as Error).message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (kind === 'loading') return <Loading text="正在解析 DOC…" />;
  if (kind === 'error' || kind === 'rtf') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-red-500">{error}</p>
        <p className="text-sm text-slate-400">
          .doc 是 1997 年的二进制格式，浏览器能力有限；转存为 .docx 后体验完整。
        </p>
      </div>
    );
  }
  if (html === null) return <Loading text="正在渲染…" />;

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
