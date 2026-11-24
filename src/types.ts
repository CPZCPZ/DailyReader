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
  /** 所属分类；空表示未分类 */
  collectionId?: string;
  /** 分类归属的更新时间，合并时与阅读进度分开比较 */
  metaUpdatedAt?: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 墓碑：同步后其他设备据此删除，不从文件里抹掉 */
  deletedAt?: number;
}

/** 书内位置。href 只用于 EPUB 目录跳转。 */
export interface BookLocator {
  type: ProgressType | 'href';
  value: string | number;
  /** 0-100，用来判断「当前页是否已有书签」 */
  percent?: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Bookmark {
  id: string;
  bookId: string;
  label: string;
  locator: BookLocator;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface HighlightRect {
  /** 相对页面盒子的 0-1 坐标，PDF 叠高亮用 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  bookId: string;
  color: HighlightColor;
  text: string;
  note?: string;
  locator: BookLocator;
  rects?: HighlightRect[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface MarksFile {
  bookmarks: Bookmark[];
  highlights: Highlight[];
}

export function emptyMarks(): MarksFile {
  return { bookmarks: [], highlights: [] };
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
