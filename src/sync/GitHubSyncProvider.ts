import { Octokit } from '@octokit/rest';
import type {
  BookMeta,
  ReadingProgress,
} from '../types';
import type {
  ConnectionTestResult,
  SyncConfig,
  SyncProvider,
  UploadItem,
} from './SyncProvider';

const BRANCH = 'main';
export const MAX_BOOK_BYTES = 100 * 1024 * 1024; // GitHub 单文件硬限制

/* ---------- base64 工具（浏览器端，分块避免栈溢出） ---------- */

export function bytesToBase64(
  data: ArrayBuffer | Uint8Array,
): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

/* ---------- 友好错误 ---------- */

export function friendlyError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  const status = e?.status;
  if (status === 401) return 'Token 无效或已过期，请在设置页重新填写';
  if (status === 403) {
    if (/rate limit/i.test(e?.message ?? ''))
      return 'GitHub API 限流，请稍后再试';
    return '无权限：fine-grained token 需要授予该仓库 Contents 读写权限';
  }
  if (status === 404) return '仓库或文件不存在';
  if (status === 409) return 'Git 引用冲突，请重新同步后再试';
  return e?.message ?? String(err);
}

/* ---------- Provider ---------- */

type BlobEntry = {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string | null;
};

export class GitHubSyncProvider implements SyncProvider {
  readonly name = 'GitHub';
  private octo: Octokit;
  private cfg: SyncConfig;
  /** 串行化写操作，避免并发 commit 互相覆盖 */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(cfg: SyncConfig) {
    this.cfg = cfg;
    this.octo = new Octokit({ auth: cfg.token });
  }

  private get o() {
    return this.cfg.owner;
  }
  private get r() {
    return this.cfg.repo;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { data: user } =
        await this.octo.rest.users.getAuthenticated();
      try {
        const repo = await this.octo.rest.repos.get({
          owner: this.cfg.owner,
          repo: this.cfg.repo,
        });
        return {
          ok: true,
          user: user.login,
          repoExists: true,
          message: `已连接 ${user.login}，仓库 ${repo.data.full_name}${
            repo.data.private ? '（私有）' : '（注意：当前为公开仓库）'
          }`,
        };
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          return {
            ok: true,
            user: user.login,
            repoExists: false,
            message: `已连接 ${user.login}，但仓库 ${this.cfg.owner}/${this.cfg.repo} 不存在，可点击「创建数据仓库」`,
          };
        }
        throw err;
      }
    } catch (err) {
      return { ok: false, message: friendlyError(err) };
    }
  }

  async ensureRepo(): Promise<void> {
    try {
      await this.octo.rest.repos.get({
        owner: this.o,
        repo: this.r,
      });
      return;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
    // 创建私有仓库（无 auto_init，稍后用 Git Data API 打第一个提交）
    await this.octo.rest.repos.createForAuthenticatedUser({
      name: this.r,
      private: true,
      auto_init: false,
      description: 'DailyReader 同步数据（自动创建）',
    });
    // 空仓库：无父提交，直接建 tree + commit + ref
    const { data: blob } = await this.octo.rest.git.createBlob({
      owner: this.o,
      repo: this.r,
      content: utf8ToBase64('[]'),
      encoding: 'base64',
    });
    const { data: tree } = await this.octo.rest.git.createTree({
      owner: this.o,
      repo: this.r,
      tree: [{ path: 'shelf.json', mode: '100644', type: 'blob', sha: blob.sha }],
    });
    const { data: commit } = await this.octo.rest.git.createCommit({
      owner: this.o,
      repo: this.r,
      message: 'init: DailyReader data repo',
      tree: tree.sha,
      parents: [],
    });
    await this.octo.rest.git.createRef({
      owner: this.o,
      repo: this.r,
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    });
  }

  /* ---------- 基础读写 ---------- */

  private async getHead(): Promise<{
    commitSha: string;
    treeSha: string;
  }> {
    const { data: ref } = await this.octo.rest.git.getRef({
      owner: this.o,
      repo: this.r,
      ref: `heads/${BRANCH}`,
    });
    const { data: commit } = await this.octo.rest.git.getCommit({
      owner: this.o,
      repo: this.r,
      commit_sha: ref.object.sha,
    });
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  /** 一次 commit 提交/删除多个文件（Git Data API，原子操作） */
  private async commitFiles(
    items: UploadItem[],
    message: string,
  ): Promise<void> {
    const run = async () => {
      const { commitSha, treeSha } = await this.getHead();
      const tree: BlobEntry[] = [];
      for (const item of items) {
        if (item.delete) {
          tree.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        if (item.content === undefined)
          throw new Error(`item ${item.path} 缺少 content`);
        const { data: blob } = await this.octo.rest.git.createBlob({
          owner: this.o,
          repo: this.r,
          content: item.content,
          encoding: 'base64',
        });
        tree.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const { data: newTree } = await this.octo.rest.git.createTree({
        owner: this.o,
        repo: this.r,
        base_tree: treeSha,
        tree,
      });
      const { data: newCommit } = await this.octo.rest.git.createCommit({
        owner: this.o,
        repo: this.r,
        message,
        tree: newTree.sha,
        parents: [commitSha],
      });
      await this.octo.rest.git.updateRef({
        owner: this.o,
        repo: this.r,
        ref: `heads/${BRANCH}`,
        sha: newCommit.sha,
      });
    };
    // 串行执行所有写操作
    this.writeQueue = this.writeQueue.then(run, run);
    await this.writeQueue;
  }

  private async readUtf8File(path: string): Promise<string | null> {
    try {
      const { data } = await this.octo.rest.repos.getContent({
        owner: this.o,
        repo: this.r,
        path,
        ref: BRANCH,
      });
      if (Array.isArray(data) || !('content' in data)) return null;
      if (data.encoding !== 'base64' || !data.content) return null;
      return base64ToUtf8(data.content);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  /* ---------- SyncProvider 实现 ---------- */

  async pullShelf(): Promise<BookMeta[] | null> {
    const text = await this.readUtf8File('shelf.json');
    if (text === null) return null;
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? (arr as BookMeta[]) : null;
  }

  private shelfItems(shelf: BookMeta[]): UploadItem[] {
    return [
      {
        path: 'shelf.json',
        content: utf8ToBase64(JSON.stringify(shelf, null, 2)),
      },
    ];
  }

  async pushShelf(books: BookMeta[]): Promise<void> {
    await this.commitFiles(
      this.shelfItems(books),
      'chore(shelf): update shelf',
    );
  }

  private bookPath(meta: Pick<BookMeta, 'id' | 'format'>): string {
    return `books/${meta.id}.${meta.format}`;
  }

  async uploadBook(meta: BookMeta, data: ArrayBuffer): Promise<void> {
    if (data.byteLength > MAX_BOOK_BYTES) {
      throw new Error(
        `书籍超过 GitHub 单文件 100MB 限制（${(data.byteLength / 1048576).toFixed(1)}MB），暂不支持云端同步`,
      );
    }
    const shelf = (await this.pullShelf()) ?? [];
    const idx = shelf.findIndex((b) => b.id === meta.id);
    const withSynced: BookMeta = { ...meta, synced: true };
    if (idx >= 0) shelf[idx] = withSynced;
    else shelf.unshift(withSynced);
    await this.commitFiles(
      [
        {
          path: this.bookPath(meta),
          content: bytesToBase64(data),
        },
        ...this.shelfItems(shelf),
      ],
      `feat(book): add ${meta.title}`,
    );
  }

  async downloadBook(meta: BookMeta): Promise<ArrayBuffer> {
    const path = this.bookPath(meta);
    // 小文件（≤1MB）Contents API 直接给 base64；大文件拿 sha 走 Blob API（≤100MB）
    const { data } = await this.octo.rest.repos.getContent({
      owner: this.o,
      repo: this.r,
      path,
      ref: BRANCH,
    });
    let b64: string;
    if (!Array.isArray(data) && data.type === 'file') {
      if (data.encoding === 'base64' && data.content) {
        b64 = data.content;
      } else if (data.sha) {
        // >1MB：Contents API 不回传内容，用 blob sha 走 Git Blobs API（≤100MB）
        const blob = await this.octo.rest.git.getBlob({
          owner: this.o,
          repo: this.r,
          file_sha: data.sha,
        });
        b64 = blob.data.content;
      } else {
        throw new Error('远端书籍文件无法读取');
      }
    } else {
      throw new Error('远端书籍文件不存在');
    }
    const bytes = base64ToBytes(b64);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async deleteBook(meta: BookMeta): Promise<void> {
    const shelf = (await this.pullShelf()) ?? [];
    const next = shelf.filter((b) => b.id !== meta.id);
    await this.commitFiles(
      [
        { path: this.bookPath(meta), delete: true },
        ...this.shelfItems(next),
      ],
      `feat(book): remove ${meta.title}`,
    );
  }

  private progressPath(bookId: string): string {
    return `progress/${bookId}.json`;
  }

  async pullProgress(bookId: string): Promise<ReadingProgress | null> {
    const text = await this.readUtf8File(this.progressPath(bookId));
    if (!text) return null;
    try {
      return JSON.parse(text) as ReadingProgress;
    } catch {
      return null;
    }
  }

  async pullAllProgress(): Promise<Record<string, ReadingProgress>> {
    const out: Record<string, ReadingProgress> = {};
    try {
      const { data } = await this.octo.rest.repos.getContent({
        owner: this.o,
        repo: this.r,
        path: 'progress',
        ref: BRANCH,
      });
      if (!Array.isArray(data)) return out;
      for (const entry of data) {
        if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -'.json'.length);
        const p = await this.pullProgress(id);
        if (p) out[id] = p;
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
    return out;
  }

  async pushProgress(
    bookId: string,
    p: ReadingProgress,
  ): Promise<boolean> {
    const remote = await this.pullProgress(bookId);
    if (remote && remote.updatedAt >= p.updatedAt) return false;
    await this.commitFiles(
      [
        {
          path: this.progressPath(bookId),
          content: utf8ToBase64(JSON.stringify(p)),
        },
      ],
      `chore(progress): ${bookId}`,
    );
    return true;
  }
}
