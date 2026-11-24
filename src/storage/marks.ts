import type {
  Bookmark,
  Highlight,
  MarksFile,
} from '../types';
import { getMarksFile, saveMarksFile } from './db';
import { scheduleSync } from '../sync/orchestrator';

async function update(mutator: (file: MarksFile) => MarksFile): Promise<MarksFile> {
  const next = mutator(await getMarksFile());
  await saveMarksFile(next);
  scheduleSync();
  return next;
}

export async function upsertBookmark(bookmark: Bookmark): Promise<void> {
  await update((file) => {
    const rest = file.bookmarks.filter((b) => b.id !== bookmark.id);
    return { ...file, bookmarks: [bookmark, ...rest] };
  });
}

export async function deleteBookmark(id: string): Promise<void> {
  const now = Date.now();
  await update((file) => ({
    ...file,
    bookmarks: file.bookmarks.map((b) =>
      b.id === id ? { ...b, deletedAt: now, updatedAt: now } : b,
    ),
  }));
}

export async function upsertHighlight(highlight: Highlight): Promise<void> {
  await update((file) => {
    const rest = file.highlights.filter((h) => h.id !== highlight.id);
    return { ...file, highlights: [highlight, ...rest] };
  });
}

export async function deleteHighlight(id: string): Promise<void> {
  const now = Date.now();
  await update((file) => ({
    ...file,
    highlights: file.highlights.map((h) =>
      h.id === id ? { ...h, deletedAt: now, updatedAt: now } : h,
    ),
  }));
}

export async function tombstoneBookMarks(bookId: string): Promise<void> {
  const now = Date.now();
  await update((file) => ({
    bookmarks: file.bookmarks.map((b) =>
      b.bookId === bookId && !b.deletedAt
        ? { ...b, deletedAt: now, updatedAt: now }
        : b,
    ),
    highlights: file.highlights.map((h) =>
      h.bookId === bookId && !h.deletedAt
        ? { ...h, deletedAt: now, updatedAt: now }
        : h,
    ),
  }));
}

export function aliveBookmarks(file: MarksFile, bookId: string): Bookmark[] {
  return file.bookmarks.filter((b) => b.bookId === bookId && !b.deletedAt);
}

export function aliveHighlights(file: MarksFile, bookId: string): Highlight[] {
  return file.highlights.filter((h) => h.bookId === bookId && !h.deletedAt);
}
