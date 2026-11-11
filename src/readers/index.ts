import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { BookFormat } from '../types';
import type { ReaderProps } from './types';

export { ScrolledHtmlReader } from './ScrolledHtmlReader';
export { Loading } from './Loading';
export type { ReaderProps, ProgressDelta } from './types';

/** 懒加载映射：每个 Reader 独立 chunk，避免首屏加载全部解析库 */
const readerMap: Record<
  BookFormat,
  LazyExoticComponent<ComponentType<ReaderProps>>
> = {
  epub: lazy(() => import('./EpubReader')),
  pdf: lazy(() => import('./PdfReader')),
  docx: lazy(() => import('./DocxReader')),
  doc: lazy(() => import('./DocReader')),
  ppt: lazy(() => import('./PptxReader')),
  pptx: lazy(() => import('./PptxReader')),
  md: lazy(() => import('./MdReader')),
  txt: lazy(() => import('./TxtReader')),
  html: lazy(() => import('./HtmlReader')),
};

export function getReader(format: BookFormat) {
  return readerMap[format];
}
