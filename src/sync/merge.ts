import type {
  BookMeta,
  Bookmark,
  Collection,
  Highlight,
  MarksFile,
  ReadingProgress,
} from '../types';
import { emptyMarks } from '../types';

/**
 * 书架合并（纯函数，便于单元测试）。
 *
 * 语义（单人使用）：
 * - 按 id 取并集；同 id 保留进度较新的一方，封面优先取有值的一侧（本地优先）
 * - remote 中不存在、但本地标记 synced 的书 → 已在别的设备上删除 → 从结果中剔除
 * - remote 中不存在、本地未 synced 的书 → 本地新书，保留待上传
 */
export function mergeShelves(
  local: BookMeta[],
  remote: BookMeta[],
): { merged: BookMeta[]; remoteDeletedIds: string[] } {
  const remoteById = new Map(remote.map((b) => [b.id, b]));
  const localById = new Map(local.map((b) => [b.id, b]));
  const remoteDeletedIds: string[] = [];

  const merged: BookMeta[] = [];

  for (const r of remote) {
    const l = localById.get(r.id);
    merged.push(l ? pickBook(l, r) : { ...r, synced: true });
  }
  for (const l of local) {
    if (remoteById.has(l.id)) continue;
    if (l.synced) {
      // 曾上传过但远端已删除 → 远端删除胜出
      remoteDeletedIds.push(l.id);
      continue;
    }
    merged.push(l);
  }
  merged.sort((a, b) => b.addedAt - a.addedAt);
  return { merged, remoteDeletedIds };
}

function pickBook(l: BookMeta, r: BookMeta): BookMeta {
  const lp = l.progress?.updatedAt ?? 0;
  const rp = r.progress?.updatedAt ?? 0;
  const base = lp >= rp ? l : r;
  const lt = l.metaUpdatedAt ?? 0;
  const rt = r.metaUpdatedAt ?? 0;
  const collectionSource = lt === 0 && rt === 0 ? base : lt >= rt ? l : r;
  return {
    ...base,
    cover: l.cover ?? r.cover,
    collectionId: collectionSource.collectionId,
    metaUpdatedAt: Math.max(lt, rt) || undefined,
    // 远端存在即视为已同步
    synced: true,
    progress: pickProgress(l.progress, r.progress) ?? base.progress,
  };
}

interface Stamp {
  id: string;
  updatedAt: number;
  deletedAt?: number;
}

/** 按 id 取并集，updatedAt 新者胜出（含删除墓碑）。时间相同保留本地。 */
export function mergeById<T extends Stamp>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of local) {
    const other = map.get(item.id);
    if (!other || item.updatedAt >= other.updatedAt) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function mergeCollections(
  local: Collection[],
  remote: Collection[],
): Collection[] {
  return mergeById(local, remote);
}

export function mergeMarks(local: MarksFile, remote: MarksFile): MarksFile {
  return {
    bookmarks: mergeById<Bookmark>(local.bookmarks ?? [], remote.bookmarks ?? []),
    highlights: mergeById<Highlight>(
      local.highlights ?? [],
      remote.highlights ?? [],
    ),
  };
}

export function normalizeMarks(file: MarksFile | null | undefined): MarksFile {
  if (!file) return emptyMarks();
  return {
    bookmarks: file.bookmarks ?? [],
    highlights: file.highlights ?? [],
  };
}

/**
 * 进度合并：last-write-wins（纯函数）。任一侧缺失时取另一侧。
 */
export function pickProgress(
  local: ReadingProgress | undefined,
  remote: ReadingProgress | undefined,
): ReadingProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return remote.updatedAt > local.updatedAt ? remote : local;
}
