import type { BookMeta, ReadingProgress } from '../types';
import {
  deleteBookLocal,
  getAllBooks,
  getAllProgressLocal,
  getBookFile,
  getProgressLocal,
  saveBookMeta,
  saveProgressLocal,
} from '../storage/db';
import { getSync } from './index';
import { mergeShelves, pickProgress } from './merge';
import { friendlyError } from './GitHubSyncProvider';
import { useSettings } from '../store/useSettings';

export interface SyncResult {
  ok: boolean;
  message: string;
  uploaded?: number;
  downloadedMeta?: number;
  removed?: number;
}

/**
 * 整书架同步：
 * 1. 拉取远端书架，合并（远端删除的书本地移除；本地新书上传）
 * 2. 拉取全部远端进度，与本地 LWW 合并，双向落盘
 * 3. 推送合并后的书架
 */
export async function syncNow(): Promise<SyncResult> {
  const provider = getSync();
  if (!provider) return { ok: false, message: '请先在设置页配置 GitHub 同步' };

  try {
    const localBooks = await getAllBooks();
    const remoteShelf = (await provider.pullShelf()) ?? [];
    const { merged, remoteDeletedIds } = mergeShelves(localBooks, remoteShelf);

    // 应用远端删除
    for (const id of remoteDeletedIds) {
      await deleteBookLocal(id);
    }

    // 上传本地新书（本地有文件且尚未同步过的）
    let uploaded = 0;
    for (const book of merged) {
      if (book.synced) continue;
      const file = await getBookFile(book.id);
      if (!file) continue; // 远端来的书本地无文件，跳过
      await provider.uploadBook(book, file);
      uploaded++;
    }

    // 进度合并
    const remoteProgress = await provider.pullAllProgress();
    const localProgress = await getAllProgressLocal();
    const shelfIds = new Set(merged.map((b) => b.id));
    for (const id of shelfIds) {
      const winner = pickProgress(localProgress[id], remoteProgress[id]);
      if (!winner) continue;
      await saveProgressLocal(id, winner);
      if (
        localProgress[id] &&
        (!remoteProgress[id] || localProgress[id].updatedAt > (remoteProgress[id]?.updatedAt ?? 0))
      ) {
        // 本地较新 → 推远端
        await provider.pushProgress(id, localProgress[id]);
      }
      // 更新书架镜像进度
      const meta = merged.find((b) => b.id === id);
      if (meta) meta.progress = winner;
    }

    // 推送书架（以合并结果为准，全部标记 synced）
    await provider.pushShelf(
      merged.map((b) => ({ ...b, synced: true })),
    );
    for (const b of merged) {
      await saveBookMeta({ ...b, synced: true });
    }

    useSettings.getState().setLastSyncAt(Date.now());
    return {
      ok: true,
      message: `同步完成：上传 ${uploaded} 本，远端删除 ${remoteDeletedIds.length} 本，进度 ${shelfIds.size} 本已对齐`,
      uploaded,
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
