import { describe, expect, it } from 'vitest';
import { mergeCollections, mergeMarks, mergeShelves, pickProgress } from '../merge';
import type { BookMeta, Bookmark, Collection, Highlight, ReadingProgress } from '../../types';

function book(p: Partial<BookMeta> & { id: string }): BookMeta {
  return {
    title: `书-${p.id}`,
    format: 'epub',
    fileName: `${p.id}.epub`,
    size: 1024,
    addedAt: 1000,
    ...p,
  };
}

function prog(updatedAt: number, percent = 10): ReadingProgress {
  return { type: 'percent', value: percent, percent, device: 'x', updatedAt };
}

describe('pickProgress（last-write-wins）', () => {
  it('任一侧缺失取另一侧', () => {
    const p = prog(1);
    expect(pickProgress(p, undefined)).toBe(p);
    expect(pickProgress(undefined, p)).toBe(p);
    expect(pickProgress(undefined, undefined)).toBeUndefined();
  });

  it('取 updatedAt 较新的一方', () => {
    const old = prog(1);
    const recent = prog(2);
    expect(pickProgress(old, recent)).toBe(recent);
    expect(pickProgress(recent, old)).toBe(recent);
  });

  it('时间相同保留本地（>= 语义）', () => {
    const local = prog(5, 20);
    const remote = prog(5, 80);
    expect(pickProgress(local, remote)).toBe(local);
  });
});

describe('mergeShelves', () => {
  it('并集：本地新书保留（未 synced）', () => {
    const local = [book({ id: 'a', synced: false, title: '本地新书' })];
    const { merged, remoteDeletedIds } = mergeShelves(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
    expect(remoteDeletedIds).toHaveLength(0);
  });

  it('远端书同步到本地（保留远端元数据）', () => {
    const remote = [book({ id: 'b', title: '云端书' })];
    const { merged } = mergeShelves([], remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('云端书');
    expect(merged[0].synced).toBe(true);
  });

  it('同 id：进度取较新，封面优先本地，synced 置 true', () => {
    const local = book({
      id: 'a',
      synced: true,
      cover: 'data:image/jpeg;base64,local',
      progress: prog(10, 30),
    });
    const remote = book({
      id: 'a',
      progress: prog(20, 60),
    });
    const { merged } = mergeShelves([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0].progress?.updatedAt).toBe(20);
    expect(merged[0].cover).toBe('data:image/jpeg;base64,local');
    expect(merged[0].synced).toBe(true);
  });

  it('远端删除胜出：本地 synced 且远端缺书 → 剔除', () => {
    const local = [book({ id: 'a', synced: true }), book({ id: 'b', synced: false })];
    const { merged, remoteDeletedIds } = mergeShelves(local, []);
    expect(remoteDeletedIds).toEqual(['a']);
    expect(merged.map((b) => b.id)).toEqual(['b']);
  });

  it('分类归属看 metaUpdatedAt，阅读进度仍取较新的一方', () => {
    const local = book({
      id: 'a',
      collectionId: 'shelf-local',
      metaUpdatedAt: 50,
      progress: prog(1, 10),
    });
    const remote = book({
      id: 'a',
      collectionId: 'shelf-remote',
      metaUpdatedAt: 10,
      progress: prog(99, 80),
    });
    const { merged } = mergeShelves([local], [remote]);
    expect(merged[0].progress?.updatedAt).toBe(99);
    expect(merged[0].collectionId).toBe('shelf-local');
    expect(merged[0].metaUpdatedAt).toBe(50);
  });

  it('结果按 addedAt 倒序', () => {
    const a = book({ id: 'a', addedAt: 1 });
    const b = book({ id: 'b', addedAt: 2 });
    const { merged } = mergeShelves([a], [b]);
    expect(merged.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

function collection(id: string, updatedAt: number, extra: Partial<Collection> = {}): Collection {
  return { id, name: id, createdAt: updatedAt, updatedAt, ...extra };
}

describe('mergeCollections', () => {
  it('并集，updatedAt 新者胜出，时间相同保留本地', () => {
    const local = [collection('a', 2, { name: '本地' }), collection('b', 5, { name: '同刻本地' })];
    const remote = [collection('a', 1, { name: '远端' }), collection('b', 5, { name: '同刻远端' }), collection('c', 3)];
    const merged = mergeCollections(local, remote);
    expect(merged.find((c) => c.id === 'a')?.name).toBe('本地');
    expect(merged.find((c) => c.id === 'b')?.name).toBe('同刻本地');
    expect(merged.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('删除墓碑若更新则保留，避免另一台设备把分类加回来', () => {
    const local = [collection('a', 10, { deletedAt: 10 })];
    const remote = [collection('a', 4, { name: '还在' })];
    const merged = mergeCollections(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].deletedAt).toBe(10);
  });
});

function bookmark(id: string, updatedAt: number, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    bookId: 'book',
    label: id,
    locator: { type: 'percent', value: 1 },
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

function highlight(id: string, updatedAt: number, extra: Partial<Highlight> = {}): Highlight {
  return {
    id,
    bookId: 'book',
    color: 'yellow',
    text: id,
    locator: { type: 'percent', value: 1, quote: id },
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

describe('mergeMarks', () => {
  it('书签和划线各自按条目合并，不整份覆盖', () => {
    const merged = mergeMarks(
      {
        bookmarks: [bookmark('b1', 2, { label: '新' })],
        highlights: [highlight('h1', 1, { text: '旧划线' })],
      },
      {
        bookmarks: [bookmark('b1', 1, { label: '旧' }), bookmark('b2', 3)],
        highlights: [highlight('h1', 5, { text: '新划线' }), highlight('h2', 4)],
      },
    );
    expect(merged.bookmarks.map((b) => b.id)).toEqual(['b2', 'b1']);
    expect(merged.bookmarks.find((b) => b.id === 'b1')?.label).toBe('新');
    expect(merged.highlights.find((h) => h.id === 'h1')?.text).toBe('新划线');
    expect(merged.highlights.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
  });

  it('较新的删除墓碑会盖过另一端仍存在的划线', () => {
    const merged = mergeMarks(
      { bookmarks: [], highlights: [highlight('h1', 8, { deletedAt: 8 })] },
      { bookmarks: [], highlights: [highlight('h1', 2, { text: '还在' })] },
    );
    expect(merged.highlights[0].deletedAt).toBe(8);
  });
});
