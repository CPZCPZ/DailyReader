import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FORMAT_ACCEPT, FORMAT_LABEL, type BookMeta, type Collection } from '../types';
import { useShelf } from '../store/useShelf';
import { useSettings } from '../store/useSettings';
import { syncNow, type SyncDetail } from '../sync/orchestrator';
import { isSyncConfigured } from '../sync';
import { storageUsage } from '../storage/db';
import { SyncSetup } from './SyncSetup';

type SortKey = 'recent' | 'added' | 'title' | 'progress';
type FilterKey = 'all' | 'none' | string;

const WIZARD_KEY = 'dr-wizard-dismissed';

export default function ShelfPage() {
  const navigate = useNavigate();
  const {
    books,
    collections,
    cachedIds,
    downloadingId,
    loaded,
    load,
    importFiles,
    remove,
    createCollection,
    renameCollection,
    deleteCollection,
    moveBook,
    noteCached,
    noteDownloading,
  } = useShelf();
  const lastSyncAt = useSettings((s) => s.lastSyncAt);
  const syncToken = useSettings((s) => s.token);
  const syncOwner = useSettings((s) => s.owner);
  const syncRepo = useSettings((s) => s.repo);
  const configured = Boolean(syncToken && syncOwner && syncRepo);
  const inputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<
    { kind: 'info' | 'error' | 'ok'; text: string } | null
  >(null);
  const [dragOver, setDragOver] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(() => useSettings.persist.hasHydrated());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [swPending, setSwPending] = useState(
    () => localStorage.getItem('dr-sw-pending') === '1',
  );
  const syncedOnce = useRef(false);

  useEffect(() => {
    const onPending = () => setSwPending(true);
    window.addEventListener('dr-sw-pending', onPending);
    return () => window.removeEventListener('dr-sw-pending', onPending);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (useSettings.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useSettings.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || configured) return;
    if (sessionStorage.getItem(WIZARD_KEY) === '1') return;
    setWizardOpen(true);
  }, [hydrated, configured]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const runSync = useCallback(
    async (manual: boolean) => {
      if (!isSyncConfigured()) {
        if (manual) setWizardOpen(true);
        return;
      }
      setSyncing(true);
      setSyncError(null);
      const result = await syncNow((stage: string, detail?: SyncDetail) => {
        setSyncStage(stage);
        if (detail?.downloadingId !== undefined) noteDownloading(detail.downloadingId);
        if (detail?.cachedId) noteCached(detail.cachedId);
      });
      await load();
      setSyncing(false);
      setSyncStage('');
      noteDownloading(null);
      if (!result.ok) setSyncError(result.message);
      else if (manual) setToast({ kind: 'ok', text: result.message });
    },
    [load, noteCached, noteDownloading],
  );

  useEffect(() => {
    if (!hydrated || !configured) return;
    if (syncedOnce.current) return;
    syncedOnce.current = true;
    void runSync(false);
  }, [hydrated, configured, runSync]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isSyncConfigured()) return;
      const last = useSettings.getState().lastSyncAt ?? 0;
      if (Date.now() - last < 60_000) return;
      void runSync(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runSync]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setToast({ kind: 'info', text: `正在导入 ${list.length} 个文件…` });
    const { added, errors } = await importFiles(list);
    const parts: string[] = [];
    if (added.length) parts.push(`成功导入 ${added.length} 本`);
    if (errors.length) parts.push(errors.join('；'));
    setToast({
      kind: errors.length && !added.length ? 'error' : 'ok',
      text: parts.join('；') || '没有可导入的文件',
    });
  }

  const aliveCollections = collections.filter((c) => !c.deletedAt);
  const continueBook = useMemo(() => {
    return [...books]
      .filter((b) => b.progress && b.progress.percent < 100)
      .sort(
        (a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0),
      )[0];
  }, [books]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => {
      if (filter === 'none') return !b.collectionId;
      if (filter !== 'all') return b.collectionId === filter;
      return true;
    });
    if (q) {
      list = list.filter((b) =>
        `${b.title} ${b.author ?? ''}`.toLowerCase().includes(q),
      );
    }
    const copy = [...list];
    copy.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh');
      if (sort === 'added') return b.addedAt - a.addedAt;
      if (sort === 'progress')
        return (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0);
      return (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0) || b.addedAt - a.addedAt;
    });
    return copy;
  }, [books, filter, query, sort]);

  return (
    <div
      className="min-h-dvh bg-slate-50 pb-16 dark:bg-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      {swPending && (
        <div className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm text-white">
          <span>新版本已就绪</span>
          <button
            className="rounded bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
            onClick={() => {
              localStorage.removeItem('dr-sw-pending');
              location.reload();
            }}
          >
            立即刷新
          </button>
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              DailyReader
            </h1>
            <p className="truncate text-xs text-slate-400">
              {syncing
                ? syncStage || '正在同步…'
                : syncError
                  ? syncError
                  : lastSyncAt
                    ? `已同步 ${formatRelative(lastSyncAt)}`
                    : configured
                      ? '尚未同步'
                      : '未连接，换设备看不到这些书'}
            </p>
          </div>
          <button
            className="btn-ghost"
            onClick={() => void runSync(true)}
            disabled={syncing}
          >
            {syncing ? '同步中…' : '同步'}
          </button>
          <Link to="/settings" className="btn-ghost" aria-label="设置">
            设置
          </Link>
        </div>
      </header>

      {!configured && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1">
              书只存在这台浏览器里。要在手机和电脑之间看到同一批书，需要连接你自己的 GitHub 私有仓库。
            </p>
            <button className="btn-primary" onClick={() => setWizardOpen(true)}>
              连接同步
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4">
        {loaded && books.length > 0 && (
          <>
            {continueBook && filter === 'all' && !query.trim() && (
              <button
                className="mt-4 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800"
                onClick={() => navigate(`/read/${continueBook.id}`)}
              >
                <Cover book={continueBook} className="h-16 w-12 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-blue-600 dark:text-blue-400">
                    继续阅读
                  </span>
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
                    {continueBook.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {Math.round(continueBook.progress?.percent ?? 0)}%
                  </span>
                </span>
              </button>
            )}

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
                全部
              </Chip>
              <Chip active={filter === 'none'} onClick={() => setFilter('none')}>
                未分类
              </Chip>
              {aliveCollections.map((c) => (
                <Chip
                  key={c.id}
                  active={filter === c.id}
                  onClick={() => setFilter(c.id)}
                >
                  {c.name}
                </Chip>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索书名"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="recent">最近阅读</option>
                <option value="added">最近导入</option>
                <option value="title">标题</option>
                <option value="progress">进度</option>
              </select>
            </div>

            <CollectionTools
              filter={filter}
              collections={aliveCollections}
              newName={newName}
              renaming={renaming}
              onNewName={setNewName}
              onCreate={() => {
                void createCollection(newName);
                setNewName('');
              }}
              onStartRename={() => {
                if (filter !== 'all' && filter !== 'none') setRenaming(filter);
              }}
              onRename={(name) => {
                if (filter !== 'all' && filter !== 'none') {
                  void renameCollection(filter, name);
                }
                setRenaming(null);
              }}
              onDelete={() => {
                if (filter === 'all' || filter === 'none') return;
                void deleteCollection(filter);
                setFilter('all');
              }}
            />
          </>
        )}

        {loaded && books.length === 0 ? (
          syncing ? (
            <p className="mt-16 text-center text-sm text-slate-400">
              正在从云端拉取书架…
            </p>
          ) : (
            <EmptyState
              configured={configured}
              onPick={() => inputRef.current?.click()}
              onConnect={() => setWizardOpen(true)}
            />
          )
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4 pt-4 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {visible.map((b) => (
              <BookCard
                key={b.id}
                book={b}
                cached={cachedIds.includes(b.id)}
                downloading={downloadingId === b.id}
                menuOpen={menuId === b.id}
                collections={aliveCollections}
                onOpen={() => navigate(`/read/${b.id}`)}
                onMenu={() => setMenuId((id) => (id === b.id ? null : b.id))}
                onMove={(collectionId) => {
                  void moveBook(b.id, collectionId);
                  setMenuId(null);
                }}
                onDelete={() => {
                  setMenuId(null);
                  setConfirmDelete(b.id);
                }}
              />
            ))}
          </div>
        )}

        {loaded && books.length > 0 && visible.length === 0 && (
          <p className="mt-8 text-center text-sm text-slate-400">这个分类里还没有书</p>
        )}

        <div
          className={`mt-8 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
              : 'border-slate-300 dark:border-slate-600'
          }`}
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">
            拖拽文件到这里，或
            <button className="link mx-1" onClick={() => inputRef.current?.click()}>
              点击选择
            </button>
            支持 PDF / EPUB / DOCX / DOC / PPT / PPTX / MD / TXT / HTML，单文件 ≤ 100MB
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FORMAT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <StorageInfo />
      </main>

      {toast && (
        <div
          className={`fixed inset-x-4 bottom-5 z-20 mx-auto max-w-md rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
            toast.kind === 'error'
              ? 'bg-red-600'
              : toast.kind === 'ok'
                ? 'bg-emerald-600'
                : 'bg-slate-700'
          }`}
        >
          {toast.text}
        </div>
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <p className="text-slate-700 dark:text-slate-200">
            确定删除《{books.find((b) => b.id === confirmDelete)?.title}》？
            {books.find((b) => b.id === confirmDelete)?.synced
              ? '将同时从云端仓库删除。'
              : '仅删除本地数据。'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </button>
            <button
              className="btn-danger"
              onClick={async () => {
                await remove(confirmDelete);
                setConfirmDelete(null);
                setToast({ kind: 'ok', text: '已删除' });
              }}
            >
              删除
            </button>
          </div>
        </Modal>
      )}

      {wizardOpen && (
        <SyncSetup
          onClose={() => {
            sessionStorage.setItem(WIZARD_KEY, '1');
            setWizardOpen(false);
          }}
          onDone={(ok, message) => {
            if (ok) {
              sessionStorage.removeItem(WIZARD_KEY);
              setWizardOpen(false);
              setToast({ kind: 'ok', text: message });
              void load();
            }
          }}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-blue-500/10">
          <p className="rounded-xl bg-white px-6 py-4 text-lg font-medium text-blue-600 shadow-xl dark:bg-slate-800">
            松开以导入书籍
          </p>
        </div>
      )}
    </div>
  );
}

function CollectionTools({
  filter,
  collections,
  newName,
  renaming,
  onNewName,
  onCreate,
  onStartRename,
  onRename,
  onDelete,
}: {
  filter: FilterKey;
  collections: Collection[];
  newName: string;
  renaming: string | null;
  onNewName: (v: string) => void;
  onCreate: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const current = collections.find((c) => c.id === filter);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <form
        className="flex min-w-0 flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate();
        }}
      >
        <input
          value={newName}
          onChange={(e) => onNewName(e.target.value)}
          placeholder="新建分类"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <button className="btn-ghost" type="submit" disabled={!newName.trim()}>
          添加
        </button>
      </form>
      {current && renaming === current.id ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            onRename(String(data.get('name') ?? ''));
          }}
        >
          <input
            name="name"
            defaultValue={current.name}
            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
          <button className="btn-ghost" type="submit">
            保存
          </button>
        </form>
      ) : (
        current && (
          <>
            <button className="btn-ghost" onClick={onStartRename}>
              重命名
            </button>
            <button className="btn-ghost" onClick={onDelete}>
              删除分类
            </button>
          </>
        )
      )}
    </div>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`shrink-0 rounded-full px-3 py-1 text-sm ${
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BookCard({
  book,
  cached,
  downloading,
  menuOpen,
  collections,
  onOpen,
  onMenu,
  onMove,
  onDelete,
}: {
  book: BookMeta;
  cached: boolean;
  downloading: boolean;
  menuOpen: boolean;
  collections: Collection[];
  onOpen: () => void;
  onMenu: () => void;
  onMove: (collectionId: string | null) => void;
  onDelete: () => void;
}) {
  const percent = Math.round(book.progress?.percent ?? 0);
  const badge = downloading
    ? '下载中'
    : !cached
      ? '未缓存'
      : !book.synced
        ? '本地'
        : null;
  return (
    <div className="relative">
      <button className="block w-full text-left" onClick={onOpen} aria-label={`打开《${book.title}》`}>
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg shadow-md ring-1 ring-slate-200 dark:ring-slate-700">
          <Cover book={book} className="h-full w-full" />
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
            {FORMAT_LABEL[book.format]}
          </span>
          {badge && (
            <span className="absolute right-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] text-white">
              {badge}
            </span>
          )}
          {percent > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
              <div className="h-full bg-blue-400" style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          {book.title}
        </p>
        {book.author && <p className="line-clamp-1 text-xs text-slate-400">{book.author}</p>}
      </button>
      <button
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-600 shadow ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600"
        style={{ top: badge ? '1.75rem' : '0.35rem' }}
        onClick={onMenu}
        aria-label={`《${book.title}》的菜单`}
      >
        ···
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-800">
          <p className="px-2 py-1 text-xs text-slate-400">移动到</p>
          <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => onMove(null)}>
            未分类
          </button>
          {collections.map((c) => (
            <button
              key={c.id}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => onMove(c.id)}
            >
              {c.name}
            </button>
          ))}
          <button
            className="mt-1 block w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function Cover({ book, className }: { book: BookMeta; className?: string }) {
  if (book.cover) {
    return <img src={book.cover} alt="" className={`object-cover ${className ?? ''}`} />;
  }
  return <GeneratedCover book={book} className={className} />;
}

function GeneratedCover({ book, className }: { book: BookMeta; className?: string }) {
  const palettes = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-400 to-rose-500',
    'from-violet-500 to-purple-600',
    'from-cyan-500 to-blue-600',
    'from-pink-500 to-rose-600',
  ];
  const idx =
    Math.abs([...book.id].reduce((a, c) => a + c.charCodeAt(0), 0)) % palettes.length;
  return (
    <div className={`flex flex-col justify-between bg-gradient-to-br p-3 ${palettes[idx]} ${className ?? ''}`}>
      <p className="line-clamp-4 text-sm font-bold leading-snug text-white/95">{book.title}</p>
      <p className="text-right text-[10px] font-medium uppercase tracking-widest text-white/70">
        DailyReader
      </p>
    </div>
  );
}

function EmptyState({
  configured,
  onPick,
  onConnect,
}: {
  configured: boolean;
  onPick: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
        {configured ? '书架还是空的' : '这台设备上还没有书'}
      </h2>
      <p className="max-w-sm text-sm text-slate-400">
        {configured
          ? '导入一本书，或等同步把其他设备上的书拉下来。'
          : '如果另一台设备已经导入过书，先连接同步；否则直接导入。'}
      </p>
      <div className="flex gap-2">
        {!configured && (
          <button className="btn-primary" onClick={onConnect}>
            连接同步
          </button>
        )}
        <button className={configured ? 'btn-primary' : 'btn-ghost'} onClick={onPick}>
          导入书籍
        </button>
      </div>
    </div>
  );
}

function StorageInfo() {
  const [info, setInfo] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void storageUsage().then(setInfo);
  }, []);
  if (!info || !info.quota) return null;
  const pct = ((info.usage / info.quota) * 100).toFixed(1);
  return (
    <p className="mt-6 text-center text-xs text-slate-400">
      本地缓存 {fmtBytes(info.usage)} / 可用 {fmtBytes(info.quota)}（{pct}%）
    </p>
  );
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return '刚刚';
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)} 小时前`;
  return new Date(ts).toLocaleString();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
