import { describe, expect, it } from 'vitest';
import { mergeShelves, pickProgress } from '../merge';
import type { BookMeta, ReadingProgress } from '../../types';

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

  it('结果按 addedAt 倒序', () => {
    const a = book({ id: 'a', addedAt: 1 });
    const b = book({ id: 'b', addedAt: 2 });
    const { merged } = mergeShelves([a], [b]);
    expect(merged.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
