import type { BookMeta, ReadingProgress } from '../types';

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  user?: string;
  repoExists?: boolean;
}

export interface UploadItem {
  path: string;
  /** base64 编码的内容；与 delete 二选一 */
  content?: string;
  delete?: boolean;
}

/**
 * 同步后端抽象。当前实现 GitHubSyncProvider（GitHub 私有仓库），
 * Phase 4 接入云服务器时实现 ServerSyncProvider，前端零改动切换。
 */
export interface SyncProvider {
  readonly name: string;

  testConnection(): Promise<ConnectionTestResult>;

  /** 确保数据仓库存在，不存在则创建并初始化 shelf.json */
  ensureRepo(): Promise<void>;

  pullShelf(): Promise<BookMeta[] | null>;
  pushShelf(books: BookMeta[]): Promise<void>;

  /** 上传书籍文件并原子性更新书架（一次 commit） */
  uploadBook(meta: BookMeta, data: ArrayBuffer): Promise<void>;
  downloadBook(meta: BookMeta): Promise<ArrayBuffer>;
  deleteBook(meta: BookMeta): Promise<void>;

  pullProgress(bookId: string): Promise<ReadingProgress | null>;
  /** 拉取全部进度（用于整书架同步） */
  pullAllProgress(): Promise<Record<string, ReadingProgress>>;
  /** 推送单本进度；远端较新则跳过并返回 false */
  pushProgress(bookId: string, p: ReadingProgress): Promise<boolean>;
}

export interface SyncConfig {
  token: string;
  owner: string;
  repo: string;
}
