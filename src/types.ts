export type BookFormat =
  | 'epub'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'ppt'
  | 'pptx'
  | 'md'
  | 'txt'
  | 'html';

export const SUPPORTED_FORMATS: BookFormat[] = [
  'epub',
  'pdf',
  'docx',
  'doc',
  'ppt',
  'pptx',
  'md',
  'txt',
  'html',
];

export const FORMAT_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(',');
export const FORMAT_LABEL: Record<BookFormat, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  ppt: 'PPT',
  pptx: 'PPTX',
  md: 'MD',
  txt: 'TXT',
  html: 'HTML',
};

export function detectFormat(fileName: string): BookFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if ((SUPPORTED_FORMATS as string[]).includes(ext)) return ext as BookFormat;
  return null;
}

/** 进度值的类型：epub 用 CFI 字符串，pdf 用页码，pptx 用幻灯片序号，其余用百分比 */
export type ProgressType = 'cfi' | 'page' | 'slide' | 'percent';

export interface ReadingProgress {
  type: ProgressType;
  /** cfi 时为字符串，其余为数字 */
  value: string | number;
  /** 0-100，仅用于展示 */
  percent: number;
  device: string;
  updatedAt: number;
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  fileName: string;
  size: number;
  addedAt: number;
  /** dataURL 缩略封面（小图），可能为空 */
  cover?: string;
  /** 该书籍是否已上传到同步仓库 */
  synced?: boolean;
  /** 最近一次进度（本地镜像，用于书架展示） */
  progress?: ReadingProgress;
}

export interface ProgressFile {
  [bookId: string]: ReadingProgress;
}

export function newId(): string {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  );
}

export function makeProgress(
  type: ProgressType,
  value: string | number,
  percent: number,
  device: string,
): ReadingProgress {
  return { type, value, percent, device, updatedAt: Date.now() };
}
