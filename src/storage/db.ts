import localforage from 'localforage';
import type { BookMeta, ReadingProgress } from '../types';

/** 书籍元数据（书架） */
export const booksStore = localforage.createInstance({
  name: 'dailyreader',
  storeName: 'books',
});

/** 书籍文件内容（ArrayBuffer），体积大，单独一个 store */
export const filesStore = localforage.createInstance({
  name: 'dailyreader',
  storeName: 'files',
});

/** 阅读进度本地镜像 */
export const progressStore = localforage.createInstance({
  name: 'dailyreader',
  storeName: 'progress',
});

export async function getAllBooks(): Promise<BookMeta[]> {
  const list: BookMeta[] = [];
  await booksStore.iterate<BookMeta, void>((v) => {
    if (v) list.push(v);
  });
  list.sort((a, b) => b.addedAt - a.addedAt);
  return list;
}

export async function saveBookMeta(meta: BookMeta): Promise<void> {
  await booksStore.setItem(meta.id, meta);
}

export async function getBookMeta(id: string): Promise<BookMeta | null> {
  return (await booksStore.getItem(id)) as BookMeta | null;
}

export async function deleteBookLocal(id: string): Promise<void> {
  await booksStore.removeItem(id);
  await filesStore.removeItem(id);
  await progressStore.removeItem(id);
}

export async function saveBookFile(id: string, data: ArrayBuffer): Promise<void> {
  await filesStore.setItem(id, data);
}

export async function getBookFile(id: string): Promise<ArrayBuffer | null> {
  return (await filesStore.getItem(id)) as ArrayBuffer | null;
}

export async function saveProgressLocal(
  id: string,
  p: ReadingProgress,
): Promise<void> {
  await progressStore.setItem(id, p);
}

export async function getProgressLocal(
  id: string,
): Promise<ReadingProgress | null> {
  return (await progressStore.getItem(id)) as ReadingProgress | null;
}

/** 全量进度（用于整书架同步时对比） */
export async function getAllProgressLocal(): Promise<
  Record<string, ReadingProgress>
> {
  const out: Record<string, ReadingProgress> = {};
  await progressStore.iterate<ReadingProgress, void>((v, k) => {
    if (v) out[k] = v;
  });
  return out;
}

export async function storageUsage(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  }
  return { usage: 0, quota: 0 };
}
