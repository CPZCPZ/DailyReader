import { create } from 'zustand';
import type { BookMeta, BookFormat, Collection, ReadingProgress } from '../types';
import { detectFormat, newId } from '../types';
import { MAX_BOOK_BYTES } from '../sync/GitHubSyncProvider';
import { getSync } from '../sync';
import {
  deleteBookLocal,
  getAllBooks,
  getAllCollections,
  getBookFile,
  listCachedBookIds,
  saveAllCollections,
  saveBookFile,
  saveBookMeta,
} from '../storage/db';
import { tombstoneBookMarks } from '../storage/marks';
import { extractImportExtras } from '../readers/covers';
import { removeBookEverywhere, scheduleSync } from '../sync/orchestrator';

interface ImportResult {
  added: BookMeta[];
  errors: string[];
}

interface ShelfState {
  books: BookMeta[];
  collections: Collection[];
  cachedIds: string[];
  downloadingId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  importFiles: (files: File[]) => Promise<ImportResult>;
  remove: (id: string) => Promise<void>;
  /** 更新某本书的进度镜像（书架进度条展示用） */
  setProgress: (id: string, p: ReadingProgress) => Promise<void>;
  markSynced: (id: string) => Promise<void>;
  replaceAll: (books: BookMeta[]) => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  moveBook: (id: string, collectionId: string | null) => Promise<void>;
  noteCached: (id: string) => void;
  noteDownloading: (id: string | null) => void;
}

export const useShelf = create<ShelfState>((set, get) => ({
  books: [],
  collections: [],
  cachedIds: [],
  downloadingId: null,
  loaded: false,

  load: async () => {
    const [books, collections, cachedIds] = await Promise.all([
      getAllBooks(),
      getAllCollections(),
      listCachedBookIds(),
    ]);
    set({ books, collections, cachedIds, loaded: true });
  },

  importFiles: async (files) => {
    const added: BookMeta[] = [];
    const errors: string[] = [];
    const provider = getSync();

    for (const file of files) {
      try {
        const format = detectFormat(file.name) as BookFormat | null;
        if (!format) {
          errors.push(`${file.name}：不支持的格式`);
          continue;
        }
        if (file.size > MAX_BOOK_BYTES) {
          errors.push(
            `${file.name}：超过 100MB（GitHub 单文件限制），暂不能导入`,
          );
          continue;
        }
        const data = await file.arrayBuffer();
        const extras = await extractImportExtras(data, format);
        const meta: BookMeta = {
          id: newId(),
          title: extras.title || file.name.replace(/\.[^.]+$/, ''),
          author: extras.author,
          format,
          fileName: file.name,
          size: file.size,
          addedAt: Date.now(),
          cover: extras.cover,
          synced: false,
        };
        await saveBookFile(meta.id, data);
        await saveBookMeta(meta);
        added.push(meta);

        // 配置了同步则后台上传（不阻塞后续导入）
        if (provider) {
          void provider
            .uploadBook(meta, data)
            .then(() => get().markSynced(meta.id))
            .catch((err) =>
              console.warn(`《${meta.title}》上传失败，稍后同步时重试`, err),
            );
        }
      } catch (err) {
        errors.push(`${file.name}：导入失败（${(err as Error).message}）`);
      }
    }

    if (added.length) {
      set({ books: [...added, ...get().books] });
    }
    return { added, errors };
  },

  remove: async (id) => {
    const meta = get().books.find((b) => b.id === id);
    if (meta) await removeBookEverywhere(meta);
    await tombstoneBookMarks(id);
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  setProgress: async (id, p) => {
    // 同值跳过：避免 relocated 等重复事件造成 meta 引用抖动
    const current = get().books.find((b) => b.id === id);
    if (
      current?.progress &&
      current.progress.value === p.value &&
      Math.abs(current.progress.percent - p.percent) < 0.5
    ) {
      return;
    }
    set({
      books: get().books.map((b) =>
        b.id === id ? { ...b, progress: p } : b,
      ),
    });
    const meta = get().books.find((b) => b.id === id);
    if (meta) await saveBookMeta(meta);
  },

  markSynced: async (id) => {
    set({
      books: get().books.map((b) =>
        b.id === id ? { ...b, synced: true } : b,
      ),
    });
    const meta = get().books.find((b) => b.id === id);
    if (meta) await saveBookMeta(meta);
  },

  replaceAll: async (books) => {
    for (const b of books) await saveBookMeta(b);
    // 清理本地已不在书架中的孤立数据
    const ids = new Set(books.map((b) => b.id));
    const old = await getAllBooks();
    for (const b of old) {
      if (!ids.has(b.id)) await deleteBookLocal(b.id);
    }
    // 保留仍存在的本地文件
    set({ books });
  },

  createCollection: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = Date.now();
    const next: Collection = {
      id: newId(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
    };
    const collections = [...get().collections, next];
    set({ collections });
    await saveAllCollections(collections);
    scheduleSync();
  },

  renameCollection: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = Date.now();
    const collections = get().collections.map((c) =>
      c.id === id ? { ...c, name: trimmed, updatedAt: now } : c,
    );
    set({ collections });
    await saveAllCollections(collections);
    scheduleSync();
  },

  deleteCollection: async (id) => {
    const now = Date.now();
    const collections = get().collections.map((c) =>
      c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c,
    );
    const books = get().books.map((b) =>
      b.collectionId === id
        ? { ...b, collectionId: undefined, metaUpdatedAt: now }
        : b,
    );
    set({ collections, books });
    await saveAllCollections(collections);
    for (const b of books) {
      if (b.metaUpdatedAt === now) await saveBookMeta(b);
    }
    scheduleSync();
  },

  moveBook: async (id, collectionId) => {
    const now = Date.now();
    const books = get().books.map((b) =>
      b.id === id
        ? { ...b, collectionId: collectionId ?? undefined, metaUpdatedAt: now }
        : b,
    );
    set({ books });
    const meta = books.find((b) => b.id === id);
    if (meta) await saveBookMeta(meta);
    scheduleSync();
  },

  noteCached: (id) => {
    if (get().cachedIds.includes(id)) return;
    set({ cachedIds: [...get().cachedIds, id] });
  },

  noteDownloading: (id) => set({ downloadingId: id }),
}));

/** 读取书籍内容；本地无缓存时尝试从云端下载 */
export async function ensureBookFile(
  meta: BookMeta,
): Promise<ArrayBuffer | null> {
  const local = await getBookFile(meta.id);
  if (local) return local;
  const provider = getSync();
  if (!provider) return null;
  const remote = await provider.downloadBook(meta);
  await saveBookFile(meta.id, remote);
  return remote;
}
