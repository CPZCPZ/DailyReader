import type { BookMeta, ReadingProgress } from '../types';
import {
  deleteBookLocal,
  getAllBooks,
  getAllCollections,
  getAllProgressLocal,
  getBookFile,
  getMarksFile,
  getProgressLocal,
  saveAllCollections,
  saveBookFile,
  saveBookMeta,
  saveMarksFile,
  saveProgressLocal,
} from '../storage/db';
import { getSync, isSyncConfigured } from './index';
import {
  mergeCollections,
  mergeMarks,
  mergeShelves,
  normalizeMarks,
  pickProgress,
} from './merge';
import { friendlyError } from './GitHubSyncProvider';
import { useSettings } from '../store/useSettings';

export interface SyncResult {
  ok: boolean;
  message: string;
  uploaded?: number;
  downloaded?: number;
  downloadedMeta?: number;
  removed?: number;
}

export interface SyncDetail {
  /** 正在下载的书籍；null 表示当前没有下载 */
  downloadingId?: string | null;
  /** 刚缓存完成的书籍 */
  cachedId?: string;
}

/** 同步阶段回调（页面展示进度用） */
export type SyncProgress = (stage: string, detail?: SyncDetail) => void;

const listeners = new Set<SyncProgress>();
let inflight: Promise<SyncResult> | null = null;

/**
 * 整书架同步：
 * 0. ensureRepo：校验数据仓库形状（防误用代码仓库），空仓库自动初始化
 * 1. 拉取远端书架，合并（远端删除的书本地移除；本地新书上传）
 * 2. 拉取全部远端进度，与本地 LWW 合并，双向落盘
 * 3. 推送合并后的书架
 * 单本书上传失败不中断整轮，汇总到结果。
 */
export function syncNow(
  onProgress: SyncProgress = () => {},
): Promise<SyncResult> {
  listeners.add(onProgress);
  if (!inflight) {
    const emit: SyncProgress = (stage, detail) => {
      for (const listener of [...listeners]) listener(stage, detail);
    };
    inflight = runSync(emit).finally(() => {
      inflight = null;
      listeners.clear();
    });
  }
  return inflight.finally(() => {
    listeners.delete(onProgress);
  });
}

let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let resyncAfter = false;

/** 本地分类 / 书签 / 划线变化后，稍等再做一轮全量同步。 */
export function scheduleSync(delay = 4000): void {
  if (!isSyncConfigured()) return;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    const run = () => {
      void syncNow().finally(() => {
        if (!resyncAfter) return;
        resyncAfter = false;
        run();
      });
    };
    if (inflight) {
      resyncAfter = true;
      void inflight.finally(() => {
        if (!resyncAfter) return;
        resyncAfter = false;
        run();
      });
      return;
    }
    run();
  }, delay);
}

async function runSync(onProgress: SyncProgress): Promise<SyncResult> {
  const provider = getSync();
  if (!provider) return { ok: false, message: '请先在设置页配置 GitHub 同步' };

  try {
    onProgress('校验数据仓库…');
    await provider.ensureRepo();

    onProgress('拉取远端书架…');
    const localBooks = await getAllBooks();
    const remoteShelf = (await provider.pullShelf()) ?? [];
    const { merged, remoteDeletedIds } = mergeShelves(localBooks, remoteShelf);

    // 应用远端删除，并给这本书的书签/划线打墓碑
    if (remoteDeletedIds.length) {
      const now = Date.now();
      const marks = await getMarksFile();
      const drop = <T extends { bookId: string; deletedAt?: number; updatedAt: number }>(
        items: T[],
      ) =>
        items.map((item) =>
          remoteDeletedIds.includes(item.bookId) && !item.deletedAt
            ? { ...item, deletedAt: now, updatedAt: now }
            : item,
        );
      await saveMarksFile({
        bookmarks: drop(marks.bookmarks),
        highlights: drop(marks.highlights),
      });
    }
    for (const id of remoteDeletedIds) {
      await deleteBookLocal(id);
    }

    // 上传本地新书（本地有文件且尚未同步过的）
    let uploaded = 0;
    const failedIds = new Set<string>();
    const failedMsgs: string[] = [];
    const toUpload = merged.filter((b) => !b.synced);
    for (let i = 0; i < toUpload.length; i++) {
      const book = toUpload[i];
      const file = await getBookFile(book.id);
      if (!file) continue; // 远端来的书本地无文件，跳过
      onProgress(`上传《${book.title}》（${i + 1}/${toUpload.length}）…`);
      try {
        await provider.uploadBook(book, file);
        uploaded++;
      } catch (err) {
        console.warn(`《${book.title}》上传失败`, err);
        failedIds.add(book.id);
        failedMsgs.push(`《${book.title}》：${friendlyError(err)}`);
      }
    }

    onProgress('合并阅读进度…');
    const remoteProgress = await provider.pullAllProgress();
    const localProgress = await getAllProgressLocal();
    const shelfIds = new Set(merged.map((b) => b.id));
    for (const id of shelfIds) {
      const winner = pickProgress(localProgress[id], remoteProgress[id]);
      if (!winner) continue;
      await saveProgressLocal(id, winner);
      if (
        localProgress[id] &&
        (!remoteProgress[id] ||
          localProgress[id].updatedAt > (remoteProgress[id]?.updatedAt ?? 0))
      ) {
        // 本地较新 → 推远端
        await provider.pushProgress(id, localProgress[id]);
      }
      // 更新书架镜像进度
      const meta = merged.find((b) => b.id === id);
      if (meta) meta.progress = winner;
    }

    // 推送书架（以合并结果为准；上传失败的书保持未同步标记，下次重试）
    onProgress('推送书架…');
    const mergedForPush = merged.map((b) => ({
      ...b,
      synced: !failedIds.has(b.id),
    }));
    await provider.pushShelf(mergedForPush);
    for (const b of mergedForPush) {
      await saveBookMeta(b);
    }

    onProgress('合并分类…');
    const remoteCollections = (await provider.pullCollections()) ?? [];
    const localCollections = await getAllCollections();
    const collections = mergeCollections(localCollections, remoteCollections);
    await saveAllCollections(collections);
    await provider.pushCollections(collections);

    onProgress('合并书签与划线…');
    const remoteMarks = normalizeMarks(await provider.pullMarks());
    const localMarks = await getMarksFile();
    const marks = mergeMarks(localMarks, remoteMarks);
    await saveMarksFile(marks);
    await provider.pushMarks(marks);

    let downloaded = 0;
    const missing: BookMeta[] = [];
    for (const book of mergedForPush) {
      if (await getBookFile(book.id)) continue;
      missing.push(book);
    }
    for (let i = 0; i < missing.length; i++) {
      const book = missing[i];
      onProgress(`下载《${book.title}》（${i + 1}/${missing.length}）…`, {
        downloadingId: book.id,
      });
      try {
        const file = await provider.downloadBook(book);
        await saveBookFile(book.id, file);
        downloaded++;
        onProgress(`下载《${book.title}》（${i + 1}/${missing.length}）…`, {
          downloadingId: null,
          cachedId: book.id,
        });
      } catch (err) {
        console.warn(`《${book.title}》下载失败`, err);
        failedMsgs.push(`《${book.title}》下载：${friendlyError(err)}`);
        onProgress(`下载《${book.title}》失败`, { downloadingId: null });
      }
    }

    useSettings.getState().setLastSyncAt(Date.now());

    const parts = [
      `上传 ${uploaded} 本`,
      downloaded ? `下载 ${downloaded} 本` : '',
      remoteDeletedIds.length ? `远端删除 ${remoteDeletedIds.length} 本` : '',
      `进度 ${shelfIds.size} 本已对齐`,
    ].filter(Boolean);
    if (failedMsgs.length) {
      return {
        ok: false,
        message: `同步部分完成：${parts.join('，')}。失败 ${failedMsgs.length} 本：${failedMsgs.join('；')}`,
        uploaded,
        downloaded,
        removed: remoteDeletedIds.length,
      };
    }
    return {
      ok: true,
      message: `同步完成：${parts.join('，')}`,
      uploaded,
      downloaded,
      removed: remoteDeletedIds.length,
    };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

/* ---------- 单本进度：拉取（打开书时） ---------- */

/** 打开书籍时调用：若远端进度较新则返回远端进度（并落盘本地），否则返回本地 */
export async function reconcileProgress(
  bookId: string,
): Promise<ReadingProgress | null> {
  const local = await getProgressLocal(bookId);
  const provider = getSync();
  if (!provider) return local;
  try {
    const remote = await provider.pullProgress(bookId);
    const winner = pickProgress(local ?? undefined, remote ?? undefined);
    if (winner && winner !== local) {
      await saveProgressLocal(bookId, winner);
      return winner;
    }
    return local;
  } catch {
    // 网络失败不阻塞本地阅读
    return local;
  }
}

/* ---------- 单本进度：防抖推送 ---------- */

interface Pusher {
  push: (p: ReadingProgress) => void;
  flush: () => void;
  cancel: () => void;
}

const DEBOUNCE_MS = 30_000;

/** 为单本书创建防抖推送器：30s 静默或 flush 时推送；失败静默（下次再推） */
export function createProgressPusher(bookId: string): Pusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: ReadingProgress | null = null;
  let inflight: Promise<void> = Promise.resolve();

  async function doPush(p: ReadingProgress) {
    const provider = getSync();
    if (!provider) return;
    try {
      await provider.pushProgress(bookId, p);
    } catch {
      // 静默失败：下次进度更新或同步时会再推
    }
  }

  return {
    push(p: ReadingProgress) {
      pending = p;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          const p2 = pending;
          pending = null;
          inflight = doPush(p2);
        }
      }, DEBOUNCE_MS);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending) {
        const p = pending;
        pending = null;
        inflight = doPush(p);
      }
      // 页面即将关闭时无法等待；读完成后立即读也会触发
      void inflight;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/* ---------- 书架辅助 ---------- */

/** 删除书籍：本地 + 远端（若已同步过） */
export async function removeBookEverywhere(meta: BookMeta): Promise<void> {
  const provider = getSync();
  await deleteBookLocal(meta.id);
  if (provider && meta.synced) {
    try {
      await provider.deleteBook(meta);
    } catch (err) {
      console.warn('远端删除失败，将在下次同步时重试', err);
    }
  }
}
