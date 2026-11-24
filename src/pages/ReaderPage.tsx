import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  newId,
  type BookLocator,
  type Highlight,
  type HighlightColor,
  type MarksFile,
  type ReadingProgress,
} from '../types';
import { emptyMarks } from '../types';
import { getReader } from '../readers';
import type { ProgressDelta, ReaderNav, TextSelectionInfo, TocEntry } from '../readers';
import { Loading } from '../readers/Loading';
import { ensureBookFile, useShelf } from '../store/useShelf';
import { useSettings, resolveTheme, type EpubFlow } from '../store/useSettings';
import { getBookMeta, getMarksFile, saveProgressLocal } from '../storage/db';
import {
  aliveBookmarks,
  aliveHighlights,
  deleteBookmark,
  deleteHighlight,
  upsertBookmark,
  upsertHighlight,
} from '../storage/marks';
import { createProgressPusher, reconcileProgress } from '../sync/orchestrator';

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  pink: '粉',
};

export default function ReaderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const loaded = useShelf((s) => s.loaded);
  const meta = useShelf((s) => s.books.find((b) => b.id === id));
  const deviceName = useSettings((s) => s.deviceName);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const setReader = useSettings((s) => s.setReader);
  const readerSet = useSettings(
    useShallow((s) => ({
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      serif: s.serif,
      margin: s.margin,
      indent: s.indent,
      epubFlow: s.epubFlow,
    })),
  );

  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [initialProgress, setInitialProgress] = useState<ReadingProgress | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(meta?.progress?.percent ?? 0);
  const [chrome, setChrome] = useState(true);
  const [drawer, setDrawer] = useState<'toc' | 'bookmarks' | 'highlights' | 'settings' | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [marks, setMarks] = useState<MarksFile>(emptyMarks);
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const [note, setNote] = useState('');
  const [jumpTo, setJumpTo] = useState<{ nonce: number; locator: BookLocator } | null>(null);
  const pusherRef = useRef<ReturnType<typeof createProgressPusher> | null>(null);
  const navRef = useRef<ReaderNav | null>(null);
  const locRef = useRef<BookLocator | null>(null);

  useEffect(() => {
    if (!loaded) void useShelf.getState().load();
  }, [loaded]);

  const bookId = meta?.id;

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await getBookMeta(bookId);
        if (!m) return;
        const [file, progress] = await Promise.all([
          ensureBookFile(m),
          reconcileProgress(bookId),
        ]);
        if (cancelled) return;
        if (!file) {
          setError(
            '本地没有这本书的文件，云端也拉取失败（未配置同步、网络不可用或远端已删除）。',
          );
          return;
        }
        setData(file);
        setInitialProgress(progress ?? undefined);
        if (progress) {
          setPercent(progress.percent);
          locRef.current = {
            type: progress.type,
            value: progress.value,
            percent: progress.percent,
          };
        }
      } catch (err) {
        if (!cancelled) setError('打开失败：' + (err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const reloadMarks = useCallback(async () => {
    setMarks(await getMarksFile());
  }, []);

  useEffect(() => {
    if (!bookId) return;
    void reloadMarks();
    const onVis = () => {
      if (document.visibilityState === 'visible') void reloadMarks();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [bookId, reloadMarks]);

  useEffect(() => {
    if (!bookId) return;
    const pusher = createProgressPusher(bookId);
    pusherRef.current = pusher;
    const flush = () => pusher.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      pusher.flush();
      pusherRef.current = null;
    };
  }, [bookId]);

  const handleProgress = useCallback(
    (delta: ProgressDelta) => {
      if (!bookId) return;
      const p: ReadingProgress = {
        ...delta,
        device: deviceName,
        updatedAt: Date.now(),
      };
      locRef.current = { type: delta.type, value: delta.value, percent: delta.percent };
      setPercent(p.percent);
      void saveProgressLocal(bookId, p);
      void useShelf.getState().setProgress(bookId, p);
      pusherRef.current?.push(p);
    },
    [bookId, deviceName],
  );

  const handleToc = useCallback((items: TocEntry[]) => setToc(items), []);
  const handleSelect = useCallback((sel: TextSelectionInfo | null) => {
    setSelection(sel);
    if (sel) setNote('');
  }, []);
  const handleSurface = useCallback(() => {
    if (window.getSelection()?.toString().trim()) return;
    setChrome((v) => !v);
    setSelection(null);
  }, []);
  const handleBindNav = useCallback((nav: ReaderNav | null) => {
    navRef.current = nav;
  }, []);

  const bookmarks = useMemo(
    () => (bookId ? aliveBookmarks(marks, bookId) : []),
    [marks, bookId],
  );
  const highlights = useMemo(
    () => (bookId ? aliveHighlights(marks, bookId) : []),
    [marks, bookId],
  );
  const markedHere = locRef.current
    ? bookmarks.some((b) => samePlace(b.locator, locRef.current as BookLocator))
    : false;

  function seek(nextPercent: number) {
    const loc = locRef.current;
    let locator: BookLocator;
    if (loc?.type === 'page') {
      const pages = loc.percent ? Math.max(1, Math.round(Number(loc.value) / (loc.percent / 100))) : 1;
      const page = Math.max(1, Math.round((nextPercent / 100) * pages));
      locator = { type: 'page', value: page, percent: nextPercent };
    } else if (loc?.type === 'slide') {
      const total = loc.percent ? Math.max(1, Math.round(Number(loc.value) / (loc.percent / 100))) : 1;
      const slide = Math.max(1, Math.round((nextPercent / 100) * total));
      locator = { type: 'slide', value: slide, percent: nextPercent };
    } else if (meta?.format === 'epub') {
      locator = { type: 'percent', value: nextPercent, percent: nextPercent };
    } else {
      locator = { type: 'percent', value: nextPercent, percent: nextPercent };
    }
    setPercent(nextPercent);
    setJumpTo({ nonce: Date.now(), locator });
  }

  function currentLocator(): BookLocator | null {
    if (locRef.current) return locRef.current;
    if (!meta) return null;
    if (meta.format === 'pdf') return { type: 'page', value: 1, percent: 0 };
    if (meta.format === 'ppt' || meta.format === 'pptx') {
      return { type: 'slide', value: 1, percent: 0 };
    }
    return { type: 'percent', value: percent, percent };
  }

  async function toggleBookmark() {
    if (!bookId) return;
    const current = currentLocator();
    if (!current) return;
    locRef.current = current;
    const existing = bookmarks.find((b) => samePlace(b.locator, current));
    if (existing) {
      await deleteBookmark(existing.id);
    } else {
      const now = Date.now();
      await upsertBookmark({
        id: newId(),
        bookId,
        label: bookmarkLabel(current),
        locator: current,
        createdAt: now,
        updatedAt: now,
      });
    }
    await reloadMarks();
  }

  async function addHighlight(color: HighlightColor, withNote: boolean) {
    if (!bookId || !selection) return;
    const now = Date.now();
    const item: Highlight = {
      id: newId(),
      bookId,
      color,
      text: selection.text,
      note: withNote ? note.trim() || undefined : undefined,
      locator: selection.locator,
      rects: selection.rects,
      createdAt: now,
      updatedAt: now,
    };
    await upsertHighlight(item);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNote('');
    await reloadMarks();
  }

  async function saveNote(h: Highlight, value: string) {
    await upsertHighlight({
      ...h,
      note: value.trim() || undefined,
      updatedAt: Date.now(),
    });
    await reloadMarks();
  }

  function go(locator: BookLocator) {
    setJumpTo({ nonce: Date.now(), locator });
    setDrawer(null);
    setChrome(true);
  }

  if (!loaded) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loading text="加载中…" />
      </div>
    );
  }
  if (!meta) {
    return (
      <Center>
        <p className="text-slate-500">书籍不存在（可能已被删除）</p>
        <Link to="/" className="link">返回书架</Link>
      </Center>
    );
  }
  if (error) {
    return (
      <Center>
        <p className="max-w-md text-center text-red-500">{error}</p>
        <div className="flex gap-3">
          <Link to="/" className="btn-primary">返回书架</Link>
          <Link to="/settings" className="btn-ghost">同步设置</Link>
        </div>
      </Center>
    );
  }
  if (!data) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loading text={`正在打开《${meta.title}》…`} />
      </div>
    );
  }

  const Reader = getReader(meta.format);
  const paged = meta.format === 'epub' || meta.format === 'pdf' || meta.format === 'ppt' || meta.format === 'pptx';
  const here = locRef.current
    ? bookmarks.some((b) => samePlace(b.locator, locRef.current as BookLocator))
    : markedHere;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 dark:bg-slate-900">
      {chrome && (
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <button
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            onClick={() => navigate('/')}
            aria-label="返回书架"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {meta.title}
            </h1>
            <p className="text-xs text-slate-400">{placeLabel(locRef.current, percent)}</p>
          </div>
          <button className="btn-ghost" onClick={() => void toggleBookmark()}>
            {here ? '已标记' : '书签'}
          </button>
          <button className="btn-ghost" onClick={() => setDrawer('toc')}>
            目录
          </button>
          <button
            className="rounded p-1.5 text-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            onClick={() => setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark')}
            aria-label="切换主题"
          >
            {resolveTheme(theme) === 'dark' ? '☾' : '☀'}
          </button>
        </header>
      )}

      <main className="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loading text="加载阅读组件…" />
            </div>
          }
        >
          <Reader
            data={data}
            bookId={meta.id}
            initialProgress={initialProgress}
            settings={readerSet}
            onProgress={handleProgress}
            highlights={highlights}
            jumpTo={jumpTo}
            onToc={handleToc}
            onTextSelect={handleSelect}
            onSurfaceClick={handleSurface}
            onBindNav={handleBindNav}
          />
        </Suspense>
        {selection && (
          <div
            className="fixed z-30 flex max-w-[90vw] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-slate-800"
            style={{
              left: clamp(selection.clientX - 110, 8, window.innerWidth - 230),
              top: clamp(selection.clientY - 52, 8, window.innerHeight - 120),
            }}
          >
            <div className="flex flex-wrap gap-1">
              {COLORS.map((color) => (
                <button
                  key={color}
                  className={`rounded px-2 py-1 text-xs hl-${color}`}
                  onClick={() => void addHighlight(color, note.trim().length > 0)}
                >
                  {COLOR_LABEL[color]}
                </button>
              ))}
              <button
                className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                onClick={() => void addHighlight('yellow', true)}
              >
                笔记
              </button>
              <button
                className="rounded px-2 py-1 text-xs text-slate-400"
                onClick={() => {
                  window.getSelection()?.removeAllRanges();
                  setSelection(null);
                }}
              >
                关闭
              </button>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="写一句笔记，再点「笔记」"
              className="w-56 max-w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-600"
            />
          </div>
        )}
      </main>

      {chrome && (
        <footer className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          {paged && (
            <button className="btn-ghost" onClick={() => navRef.current?.prev()} aria-label="上一页">
              上一页
            </button>
          )}
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={Math.min(100, Math.max(0, percent))}
            onChange={(e) => seek(Number(e.target.value))}
            className="min-w-0 flex-1"
            aria-label="阅读进度"
          />
          <span className="w-12 text-right text-xs text-slate-400">{Math.round(percent)}%</span>
          {paged && (
            <button className="btn-ghost" onClick={() => navRef.current?.next()} aria-label="下一页">
              下一页
            </button>
          )}
        </footer>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDrawer(null)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {(
                [
                  ['toc', '目录'],
                  ['bookmarks', '书签'],
                  ['highlights', '划线'],
                  ['settings', '设置'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-full px-3 py-1 text-sm ${
                    drawer === key
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                  }`}
                  onClick={() => setDrawer(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {drawer === 'toc' && (
              <ItemList
                empty={meta.format === 'txt' ? '没有识别到「第 X 章」，可以继续用进度条跳转' : '这本书没有目录'}
                items={toc.map((item) => ({
                  id: item.id,
                  title: item.label,
                  onOpen: () => go(item.locator),
                }))}
              />
            )}
            {drawer === 'bookmarks' && (
              <ItemList
                empty="还没有书签。读到想记住的地方，点顶部「书签」。"
                items={bookmarks.map((b) => ({
                  id: b.id,
                  title: b.label,
                  onOpen: () => go(b.locator),
                  onDelete: () => void deleteBookmark(b.id).then(reloadMarks),
                }))}
              />
            )}
            {drawer === 'highlights' && (
              <HighlightList
                items={highlights}
                onOpen={(h) => go(h.locator)}
                onDelete={(h) => void deleteHighlight(h.id).then(reloadMarks)}
                onNote={(h, value) => void saveNote(h, value)}
              />
            )}
            {drawer === 'settings' && (
              <ReaderSettingsPanel
                fontSize={readerSet.fontSize}
                lineHeight={readerSet.lineHeight}
                margin={readerSet.margin}
                serif={readerSet.serif}
                indent={readerSet.indent}
                epubFlow={readerSet.epubFlow}
                showFlow={meta.format === 'epub'}
                theme={theme}
                onTheme={setTheme}
                onChange={setReader}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function samePlace(a: BookLocator, b: BookLocator): boolean {
  if (a.type === 'page' && b.type === 'page') return Number(a.value) === Number(b.value);
  if (a.type === 'slide' && b.type === 'slide') return Number(a.value) === Number(b.value);
  if (a.type === 'cfi' && b.type === 'cfi') {
    if (a.percent != null && b.percent != null) return Math.abs(a.percent - b.percent) < 1.2;
    return String(a.value) === String(b.value);
  }
  if (a.type === 'percent' || b.type === 'percent') {
    const ap = a.percent ?? (a.type === 'percent' ? Number(a.value) : NaN);
    const bp = b.percent ?? (b.type === 'percent' ? Number(b.value) : NaN);
    return Number.isFinite(ap) && Number.isFinite(bp) && Math.abs(ap - bp) < 1.5;
  }
  return false;
}

function bookmarkLabel(loc: BookLocator): string {
  if (loc.type === 'page') return `第 ${loc.value} 页`;
  if (loc.type === 'slide') return `幻灯片 ${loc.value}`;
  if (loc.quote) return loc.quote.slice(0, 24);
  return `${Math.round(loc.percent ?? 0)}%`;
}

function placeLabel(loc: BookLocator | null, percent: number): string {
  if (loc?.type === 'page') return `第 ${loc.value} 页 · ${Math.round(percent)}%`;
  if (loc?.type === 'slide') return `幻灯片 ${loc.value}`;
  return `${Math.round(percent)}%`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function ItemList({
  items,
  empty,
}: {
  items: { id: string; title: string; onOpen: () => void; onDelete?: () => void }[];
  empty: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 border-b border-slate-100 py-2 dark:border-slate-700">
          <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={item.onOpen}>
            {item.title}
          </button>
          {item.onDelete && (
            <button className="text-xs text-slate-400" onClick={item.onDelete}>
              删除
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function HighlightList({
  items,
  onOpen,
  onDelete,
  onNote,
}: {
  items: Highlight[];
  onOpen: (h: Highlight) => void;
  onDelete: (h: Highlight) => void;
  onNote: (h: Highlight, note: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-slate-400">选中文字后可以划线，也可以附一句笔记。</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((h) => (
        <li key={h.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <button className="block w-full text-left" onClick={() => onOpen(h)}>
            <span className={`mr-2 inline-block rounded px-1.5 text-xs hl-${h.color}`}>{COLOR_LABEL[h.color]}</span>
            <span className="text-sm text-slate-800 dark:text-slate-100">{h.text}</span>
          </button>
          {h.note && editing !== h.id && (
            <p className="mt-1 text-xs text-slate-500">{h.note}</p>
          )}
          {editing === h.id ? (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                onNote(h, String(data.get('note') ?? ''));
                setEditing(null);
              }}
            >
              <input
                name="note"
                defaultValue={h.note ?? ''}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-600"
              />
              <button className="btn-ghost" type="submit">保存</button>
            </form>
          ) : (
            <div className="mt-2 flex gap-3 text-xs text-slate-400">
              <button onClick={() => setEditing(h.id)}>编辑笔记</button>
              <button onClick={() => onDelete(h)}>删除</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReaderSettingsPanel({
  fontSize,
  lineHeight,
  margin,
  serif,
  indent,
  epubFlow,
  showFlow,
  theme,
  onTheme,
  onChange,
}: {
  fontSize: number;
  lineHeight: number;
  margin: number;
  serif: boolean;
  indent: boolean;
  epubFlow: EpubFlow;
  showFlow: boolean;
  theme: 'light' | 'dark' | 'system';
  onTheme: (t: 'light' | 'dark' | 'system') => void;
  onChange: (patch: {
    fontSize?: number;
    lineHeight?: number;
    margin?: number;
    serif?: boolean;
    indent?: boolean;
    epubFlow?: EpubFlow;
  }) => void;
}) {
  return (
    <div className="flex flex-col gap-4 py-2 text-sm">
      <label className="flex flex-col gap-1">
        <span>字号 {fontSize}px</span>
        <input type="range" min={12} max={28} value={fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1">
        <span>行距 {lineHeight.toFixed(1)}</span>
        <input type="range" min={1.2} max={2.6} step={0.1} value={lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1">
        <span>页边距 {margin}px</span>
        <input type="range" min={0} max={48} step={2} value={margin} onChange={(e) => onChange({ margin: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={serif} onChange={(e) => onChange({ serif: e.target.checked })} />
        衬线字体
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={indent} onChange={(e) => onChange({ indent: e.target.checked })} />
        中文首行缩进
      </label>
      {showFlow && (
        <div className="flex gap-2">
          {(['paginated', 'scrolled'] as const).map((flow) => (
            <button
              key={flow}
              className={`flex-1 rounded-lg border px-3 py-1.5 ${epubFlow === flow ? 'border-blue-500 text-blue-600' : 'border-slate-200 text-slate-500 dark:border-slate-600'}`}
              onClick={() => onChange({ epubFlow: flow })}
            >
              {flow === 'paginated' ? '分页' : '滚动'}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {(['light', 'dark', 'system'] as const).map((t) => (
          <button
            key={t}
            className={`flex-1 rounded-lg border px-3 py-1.5 ${theme === t ? 'border-blue-500 text-blue-600' : 'border-slate-200 text-slate-500 dark:border-slate-600'}`}
            onClick={() => onTheme(t)}
          >
            {t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-8">
      {children}
    </div>
  );
}
