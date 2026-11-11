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
  if (status === 422 && /fast forward/i.test(e?.message ?? ''))
    return 'Git 引用冲突（多端同时写入），请重新同步';
  return e?.message ?? String(err);
}

/** 判断是否 fast-forward 冲突（另一端在我们读取 head 后推进了 main）。
 * GitHub 对非快进 updateRef 实际返回 422，也出现过 409，两者都认。 */
function isFastForwardError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e?.status === 409) return true;
  if (e?.status === 422 && /fast forward/i.test(e?.message ?? '')) return true;
  return /fast forward/i.test(e?.message ?? '');
}

/** 判断是否"仓库为空"：
 *  - 404（无该引用）
 *  - 409 且消息含 empty（GitHub 对空仓库的 refs 接口返回 409 "Git Repository is empty"） */
function isEmptyRepoError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e?.status === 404) return true;
  return e?.status === 409 && /empty/i.test(e?.message ?? '');
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
  /** 数据仓库形状校验缓存（写入口守卫用） */
  private shapeCache: {
    ok: boolean;
    emptyRepo: boolean;
    reason?: string;
  } | null = null;

  constructor(cfg: SyncConfig, octo?: Octokit) {
    this.cfg = cfg;
    // octo 仅测试注入用
    this.octo = octo ?? new Octokit({ auth: cfg.token });
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
        await this.octo.rest.repos.get({
          owner: this.cfg.owner,
          repo: this.cfg.repo,
        });
        // 仓库存在 ≠ 可作为数据仓库：校验形状（空仓库 或 已有 shelf.json）
        const shape = await this.checkDataRepoShape();
        if (!shape.ok) {
          return {
            ok: false,
            user: user.login,
            message: shape.reason ?? '仓库不可用作数据仓库',
          };
        }
        return {
          ok: true,
          user: user.login,
          repoExists: true,
          message: shape.emptyRepo
            ? `已连接 ${user.login}，仓库 ${this.cfg.repo} 是空仓库，首次同步会自动初始化`
            : `已连接 ${user.login}，数据仓库 ${this.cfg.owner}/${this.cfg.repo} 就绪`,
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

  /**
   * 数据仓库形状校验（纯读取）：
   * - 无 main 分支 → 空仓库，可作为数据仓库（首次写入时初始化）
   * - 有 main 且存在 shelf.json → 合法数据仓库
   * - 有 main 但没有 shelf.json → 不是数据仓库（如代码仓库），拒绝使用
   */
  private async checkDataRepoShape(): Promise<{
    ok: boolean;
    emptyRepo: boolean;
    reason?: string;
  }> {
    try {
      await this.octo.rest.git.getRef({
        owner: this.o,
        repo: this.r,
        ref: `heads/${await this.branch()}`,
      });
    } catch (err) {
      if (isEmptyRepoError(err)) return { ok: true, emptyRepo: true };
      throw err;
    }
    const shelf = await this.readUtf8File('shelf.json').catch(() => null);
    if (shelf !== null) return { ok: true, emptyRepo: false };
    return {
      ok: false,
      emptyRepo: false,
      reason: `仓库 ${this.cfg.owner}/${this.cfg.repo} 已有其他内容（无 shelf.json），不是 DailyReader 数据仓库。请在设置里改用专用的空仓库名（默认 reader-data），不要填代码仓库 DailyReader`,
    };
  }

  async ensureRepo(): Promise<void> {
    let repoExists = true;
    try {
      await this.octo.rest.repos.get({
        owner: this.o,
        repo: this.r,
      });
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
      repoExists = false;
    }
    if (!repoExists) {
      // 创建私有仓库（需 Administration 权限；无权限时给出明确提示）
      try {
        await this.octo.rest.repos.createForAuthenticatedUser({
          name: this.r,
          private: true,
          auto_init: false,
          description: 'DailyReader 同步数据（自动创建）',
        });
      } catch (err) {
        throw new Error(
          `创建仓库失败（${friendlyError(err)}）。也可先在 GitHub 手动建一个空的私有仓库 ${this.r}，或检查 token 是否有 Administration 权限`,
        );
      }
      await this.initEmptyRepo();
      return;
    }
    // 仓库已存在：必须是空仓库或数据仓库，防止误用代码仓库
    const shape = await this.checkDataRepoShape();
    if (!shape.ok) throw new Error(shape.reason);
    if (shape.emptyRepo) await this.initEmptyRepo();
  }

  /** 在空仓库中打出第一个提交（shelf.json 空数组 + 默认分支）。
   * 注意：零提交的空仓库上 Git Data API（blobs/trees/commits/refs）一律 409，
   * 只能走 Contents API PUT —— 它会创建首个提交和默认分支。 */
  private async initEmptyRepo(): Promise<void> {
    try {
      await this.octo.rest.repos.createOrUpdateFileContents({
        owner: this.o,
        repo: this.r,
        path: 'shelf.json',
        message: 'init: DailyReader data repo',
        content: utf8ToBase64('[]'),
      });
    } catch (err) {
      // 并发初始化时另一端可能已建好首提交，忽略
      if (!isEmptyRepoError(err) && (err as { status?: number }).status !== 409) {
        throw err;
      }
    }
    this.shapeCache = { ok: true, emptyRepo: false };
  }

  /** 数据仓库实际使用的分支（默认取仓库 default_branch，兜底 main） */
  private branchCache: string | null = null;
  private async branch(): Promise<string> {
    if (this.branchCache) return this.branchCache;
    try {
      const { data } = await this.octo.rest.repos.get({
        owner: this.o,
        repo: this.r,
      });
      this.branchCache = data.default_branch || BRANCH;
    } catch {
      this.branchCache = BRANCH;
    }
    return this.branchCache;
  }

  /* ---------- 基础读写 ---------- */

  private async getHead(): Promise<{
    commitSha: string;
    treeSha: string;
  }> {
    // GitHub 的 GET 端点（git/ref、/commits 等）都有 CDN 缓存：URL 不变就会
    // 拿到旧 head，据此建的提交必被 updateRef 判为非快进。
    // 用 `_` 时间戳参数让每次 URL 唯一，绕过缓存读最新 tip。
    const { data } = await this.octo.request(
      'GET /repos/{owner}/{repo}/commits',
      {
        owner: this.o,
        repo: this.r,
        sha: await this.branch(),
        per_page: 1,
        _: Date.now(),
      },
    );
    const tip = data?.[0];
    if (!tip) throw new Error('数据仓库没有任何提交，请先在设置页点击「创建数据仓库」');
    return {
      commitSha: tip.sha,
      treeSha: (tip.commit.tree as { sha: string }).sha,
    };
  }

  /** fast-forward 重试退避表（毫秒）；测试可覆写为 0 */
  retryBackoffMs = [0, 1500, 4000, 8000];

  /** 一次 commit 提交/删除多个文件（Git Data API，原子操作）。
   * 写入口统一做：数据仓库形状守卫（防误用代码仓库）+ fast-forward 冲突重试 */
  private async commitFiles(
    items: UploadItem[],
    message: string,
  ): Promise<void> {
    const run = async () => {
      await this.ensureWritable();

      // fast-forward 冲突重试（带退避）：
      // - 常见原因：其他设备/标签页同时写入
      // - 已知怪癖：空仓库刚被 Contents API 初始化后，refs 写路径有数秒
      //   replication lag，会短暂地误报 fast-forward 冲突，退避后自愈
      const MAX_ATTEMPTS = 4;
      for (let attempt = 1; ; attempt++) {
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
        try {
          await this.octo.rest.git.updateRef({
            owner: this.o,
            repo: this.r,
            ref: `heads/${await this.branch()}`,
            sha: newCommit.sha,
          });
          return;
        } catch (err) {
          // fast-forward 冲突：重读 head 重建提交，退避后重试
          if (isFastForwardError(err) && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, this.retryBackoffMs[attempt - 1]));
            continue;
          }
          throw err;
        }
      }
    };
    // 串行执行所有写操作
    this.writeQueue = this.writeQueue.then(run, run);
    await this.writeQueue;
  }

  /**
   * 写前守卫：仓库必须是空仓库或数据仓库（实例内缓存结果）。
   * 空仓库自动初始化；有内容但无 shelf.json → 拒绝（防止把书写进代码仓库）。
   */
  private async ensureWritable(): Promise<void> {
    if (this.shapeCache) {
      if (!this.shapeCache.ok) throw new Error(this.shapeCache.reason);
      if (this.shapeCache.emptyRepo) {
        // 缓存了"空仓库"但尚未初始化（ensureRepo 未跑过）：先初始化
        await this.initEmptyRepo();
      }
      return;
    }
    const shape = await this.checkDataRepoShape();
    this.shapeCache = shape;
    if (!shape.ok) throw new Error(shape.reason);
    if (shape.emptyRepo) await this.initEmptyRepo();
  }

  private async readUtf8File(path: string): Promise<string | null> {
    try {
      // `_` 为 cache-busting 参数：GitHub Contents API 也有 CDN 缓存，
      // 同步场景必须读到最新内容（URL 唯一化绕过缓存）
      const { data } = await this.octo.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner: this.o,
          repo: this.r,
          path,
          ref: await this.branch(),
          _: Date.now(),
        },
      );
      if (Array.isArray(data) || typeof data !== 'object' || data === null)
        return null;
      const file = data as { encoding?: string; content?: string };
      if (file.encoding !== 'base64' || !file.content) return null;
      return base64ToUtf8(file.content);
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
      ref: await this.branch(),
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
      const { data } = await this.octo.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner: this.o,
          repo: this.r,
          path: 'progress',
          ref: await this.branch(),
          _: Date.now(),
        },
      );
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
