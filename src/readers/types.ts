import type { ProgressType, ReadingProgress } from '../types';
import type { ReaderSettings } from '../store/useSettings';

/** Reader 上报的进度核心字段；device/updatedAt 由 ReaderPage 补全 */
export interface ProgressDelta {
  type: ProgressType;
  value: string | number;
  percent: number;
}

/**
 * 所有格式 Reader 的统一接口。
 * - data：书籍原始字节
 * - initialProgress：上次进度（可能来自本地或云端）
 * - onProgress：进度变化时回调（Reader 内部已节流，页面层负责补全、落盘与同步）
 */
export interface ReaderProps {
  data: ArrayBuffer;
  bookId: string;
  initialProgress?: ReadingProgress;
  settings: ReaderSettings;
  onProgress: (p: ProgressDelta) => void;
}
