import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FORMAT_ACCEPT, FORMAT_LABEL, type BookMeta } from '../types';
import { useShelf } from '../store/useShelf';
import { useSettings } from '../store/useSettings';
import { syncNow } from '../sync/orchestrator';
import { isSyncConfigured } from '../sync';
import { storageUsage } from '../storage/db';

export default function ShelfPage() {
  const navigate = useNavigate();
  const { books, loaded, load, importFiles, remove } = useShelf();
  const lastSyncAt = useSettings((s) => s.lastSyncAt);
  const inputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<
    { kind: 'info' | 'error' | 'ok'; text: string } | null
  >(null);
  const [dragOver, setDragOver] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

  async function handleSync() {
    setSyncing(true);
    setToast({ kind: 'info', text: '正在同步…' });
    const result = await syncNow((stage) =>
      setToast({ kind: 'info', text: stage }),
    );
    await load();
    setSyncing(false);
    setToast({ kind: result.ok ? 'ok' : 'error', text: result.message });
  }

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
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <h1 className="flex-1 text-lg font-bold text-slate-800 dark:text-slate-100">
            📚 DailyReader
          </h1>
          <button
            className="btn-ghost"
            onClick={() => void handleSync()}
            disabled={syncing}
            title={
              isSyncConfigured()
                ? lastSyncAt
                  ? `上次同步：${new Date(lastSyncAt).toLocaleString()}`
                  : '从未同步'
                : '未配置同步，点击去设置'
            }
          >
            {syncing ? '同步中…' : '⟳ 同步'}
          </button>
          <Link to="/settings" className="btn-ghost" aria-label="设置">
            ⚙
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        {loaded && books.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4 pt-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {books.map((b) => (
              <BookCard
                key={b.id}
                book={b}
                onOpen={() => navigate(`/read/${b.id}`)}
                onDelete={() => setConfirmDelete(b.id)}
              />
            ))}
          </div>
        )}

        {/* 导入区 */}
        <div
          className={`mt-8 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
              : 'border-slate-300 dark:border-slate-600'
          }`}
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">
            拖拽文件到这里，或
            <button
              className="link mx-1"
              onClick={() => inputRef.current?.click()}
            >
              点击选择
            </button>
            支持PDF / EPUB / DOCX / DOC / PPT / PPTX / MD / TXT / HTML，单文件 ≤ 100MB
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

      {/* toast */}
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

      {/* 删除确认 */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <p className="text-slate-700 dark:text-slate-200">
            确定删除《
            {books.find((b) => b.id === confirmDelete)?.title}》？
            {books.find((b) => b.id === confirmDelete)?.synced
              ? '将同时从云端仓库删除。'
              : '仅删除本地数据。'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="btn-ghost"
              onClick={() => setConfirmDelete(null)}
            >
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

      {/* 拖拽全屏遮罩 */}
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

function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: BookMeta;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const percent = Math.round(book.progress?.percent ?? 0);
  return (
    <div className="group relative">
      <button
        className="block w-full text-left"
        onClick={onOpen}
        aria-label={`打开《${book.title}》`}
      >
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg shadow-md ring-1 ring-slate-200 dark:ring-slate-700">
          {book.cover ? (
            <img
              src={book.cover}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <GeneratedCover book={book} />
          )}
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
            {FORMAT_LABEL[book.format]}
          </span>
          {!book.synced && (
            <span
              className="absolute right-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] text-white"
              title="尚未上传到云端"
            >
              本地
            </span>
          )}
          {/* 进度条 */}
          {percent > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
              <div
                className="h-full bg-blue-400"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          {book.title}
        </p>
        {book.author && (
          <p className="line-clamp-1 text-xs text-slate-400">{book.author}</p>
        )}
      </button>
      <button
        className="absolute -right-1.5 -top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-slate-400 shadow ring-1 ring-slate-200 hover:text-red-500 group-hover:flex dark:bg-slate-700 dark:ring-slate-600"
        onClick={onDelete}
        aria-label={`删除《${book.title}》`}
      >
        ✕
      </button>
    </div>
  );
}

/** 无封面书籍的生成式封面：渐变底 + 标题 */
function GeneratedCover({ book }: { book: BookMeta }) {
  const palettes = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-400 to-rose-500',
    'from-violet-500 to-purple-600',
    'from-cyan-500 to-blue-600',
    'from-pink-500 to-rose-600',
  ];
  const idx =
    Math.abs(
      [...book.id].reduce((a, c) => a + c.charCodeAt(0), 0),
    ) % palettes.length;
  return (
    <div
      className={`flex h-full w-full flex-col justify-between bg-gradient-to-br p-3 ${palettes[idx]}`}
    >
      <p className="line-clamp-4 text-sm font-bold leading-snug text-white/95">
        {book.title}
      </p>
      <p className="text-right text-[10px] font-medium uppercase tracking-widest text-white/70">
        DailyReader
      </p>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <div className="text-5xl">📖</div>
      <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
        书架还是空的
      </h2>
      <p className="max-w-sm text-sm text-slate-400">
        导入你的第一本书，配置 GitHub 同步后即可在手机、电脑之间无缝接力阅读。
      </p>
      <button className="btn-primary" onClick={onPick}>
        导入书籍
      </button>
    </div>
  );
}

function StorageInfo() {
  const [info, setInfo] = useState<{ usage: number; quota: number } | null>(
    null,
  );
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
