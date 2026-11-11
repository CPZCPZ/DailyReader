import type {
  BookMeta,
  ReadingProgress,
} from '../types';
import type { SyncProvider } from './SyncProvider';

/**
 * Phase 4 占位：云服务器后端（Spring Boot）。
 * 买了服务器后在这里对接自建 API，替换 GitHub 作为同步后端。
 * 届时可解锁：LibreOffice 转换 doc/ppt、突破 100MB 限制、全文搜索、AI 功能。
 */
export class ServerSyncProvider implements SyncProvider {
  readonly name = 'Server';

  private unsupported(): never {
    throw new Error(
      '云服务器后端尚未启用（Phase 4）。当前请使用 GitHub 同步。',
    );
  }

  async pullShelf(): Promise<BookMeta[] | null> {
    this.unsupported();
  }
  async pushShelf(): Promise<void> {
    this.unsupported();
  }
  async uploadBook(): Promise<void> {
    this.unsupported();
  }
  async downloadBook(): Promise<ArrayBuffer> {
    this.unsupported();
  }
  async deleteBook(): Promise<void> {
    this.unsupported();
  }
  async pullProgress(): Promise<ReadingProgress | null> {
    this.unsupported();
  }
  async pullAllProgress(): Promise<Record<string, ReadingProgress>> {
    this.unsupported();
  }
  async pushProgress(): Promise<boolean> {
    this.unsupported();
  }
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: '云服务器后端尚未启用（Phase 4）' };
  }
  async ensureRepo(): Promise<void> {
    this.unsupported();
  }
}
