import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import type { ReadingProgress } from '../types';
import { getReader } from '../readers';
import type { ProgressDelta } from '../readers';
import { Loading } from '../readers/Loading';
import { ensureBookFile, useShelf } from '../store/useShelf';
import { useSettings, resolveTheme } from '../store/useSettings';
import { getBookMeta, saveProgressLocal } from '../storage/db';
import {
  createProgressPusher,
  reconcileProgress,
} from '../sync/orchestrator';

export default function ReaderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const loaded = useShelf((s) => s.loaded);
  const meta = useShelf((s) => s.books.find((b) => b.id === id));
  const deviceName = useSettings((s) => s.deviceName);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const readerSet = useSettings(
    useShallow((s) => ({
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      serif: s.serif,
    })),
  );

  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [initialProgress, setInitialProgress] = useState<
    ReadingProgress | undefined
  >();
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(
    meta?.progress?.percent ?? 0,
  );
  const pusherRef = useRef<ReturnType<typeof createProgressPusher> | null>(
    null,
  );

  // 刷新后 store 可能未加载
  useEffect(() => {
    if (!loaded) void useShelf.getState().load();
  }, [loaded]);

  const bookId = meta?.id;

  // 加载书籍数据 + 进度对齐（本地 vs 云端，取较新）。
  // 依赖必须是 bookId（字符串）而非 meta 对象：meta 会因进度镜像更新而改变引用，
  // 若依赖 meta 会形成“进度更新→重载→再显示→再上报”的无限循环。
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
        if (progress) setPercent(progress.percent);
      } catch (err) {
        if (!cancelled)
          setError('打开失败：' + (err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // 进度推送器生命周期：30s 防抖推送 + 关闭页面时 flush
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
      setPercent(p.percent);
      void saveProgressLocal(bookId, p);
      void useShelf.getState().setProgress(bookId, p);
      pusherRef.current?.push(p);
    },
    [bookId, deviceName],
  );

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
        <Link to="/" className="link">
          返回书架
        </Link>
      </Center>
    );
  }
  if (error) {
    return (
      <Center>
        <p className="max-w-md text-center text-red-500">{error}</p>
        <div className="flex gap-3">
          <Link to="/" className="btn-primary">
            返回书架
          </Link>
          <Link to="/settings" className="btn-ghost">
            同步设置
          </Link>
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

  return (
    <div className="flex h-dvh flex-col bg-slate-50 dark:bg-slate-900">
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
          <p className="text-xs text-slate-400">
            {Math.round(percent)}% · {meta.progress?.device ?? ''}
          </p>
        </div>
        <FontSizeControls />
        <button
          className="rounded p-1.5 text-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={() =>
            setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark')
          }
          aria-label="切换主题"
        >
          {resolveTheme(theme) === 'dark' ? '☾' : '☀'}
        </button>
      </header>

      <main className="min-h-0 flex-1">
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
          />
        </Suspense>
      </main>
    </div>
  );
}

function FontSizeControls() {
  const fontSize = useSettings((s) => s.fontSize);
  const setReader = useSettings((s) => s.setReader);
  return (
    <div className="flex items-center rounded border border-slate-200 dark:border-slate-600">
      <button
        className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
        disabled={fontSize <= 12}
        onClick={() => setReader({ fontSize: fontSize - 1 })}
        aria-label="减小字号"
      >
        A-
      </button>
      <span className="w-7 text-center text-xs text-slate-400">
        {fontSize}
      </span>
      <button
        className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
        disabled={fontSize >= 28}
        onClick={() => setReader({ fontSize: fontSize + 1 })}
        aria-label="增大字号"
      >
        A+
      </button>
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
