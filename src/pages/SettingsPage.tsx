import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../store/useSettings';
import { useShelf } from '../store/useShelf';
import { connectAndSync } from '../sync/connect';
import { fmtBytes } from './ShelfPage';
import { storageUsage } from '../storage/db';

export default function SettingsPage() {
  const settings = useSettings();
  const [status, setStatus] = useState<
    { kind: 'ok' | 'error' | 'info'; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    setStatus({ kind: 'info', text: '正在连接…' });
    const result = await connectAndSync((stage) =>
      setStatus({ kind: 'info', text: stage }),
    );
    await useShelf.getState().load();
    setBusy(false);
    setStatus({ kind: result.ok ? 'ok' : 'error', text: result.message });
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 dark:bg-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <Link to="/" className="btn-ghost" aria-label="返回">
            ←
          </Link>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            设置
          </h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-6">
        {/* 同步配置 */}
        <section className="card">
          <h2 className="card-title">☁️ GitHub 同步</h2>
          <p className="card-desc">
            书籍、进度、书架全部存放在你自己的私有仓库里，多端登录同一
            Token 即可同步。初始部署零成本，未来可无缝迁移到自建服务器。
          </p>

          <label className="field">
            <span>Personal Access Token（推荐 fine-grained）</span>
            <input
              type="password"
              value={settings.token}
              placeholder="github_pat_… 或 ghp_…"
              onChange={(e) => settings.setSync({ token: e.target.value.trim() })}
              autoComplete="off"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>用户名 / 组织</span>
              <input
                value={settings.owner}
                placeholder="your-github-username"
                onChange={(e) =>
                  settings.setSync({ owner: e.target.value.trim() })
                }
              />
            </label>
            <label className="field">
              <span>数据仓库名（专用仓库，默认 reader-data）</span>
              <input
                value={settings.repo}
                placeholder="reader-data"
                onChange={(e) =>
                  settings.setSync({ repo: e.target.value.trim() })
                }
              />
              <span className="mt-1 block text-xs font-normal text-slate-400">
                书籍和进度存在这个专用私有仓库里。
                <b className="text-amber-600 dark:text-amber-400">
                  不要填 DailyReader
                </b>
                （那是代码仓库，应用会拒绝同步以防误写）。
              </span>
            </label>
          </div>

          <label className="field">
            <span>本设备名称（进度里会显示“上次读到…”）</span>
            <input
              value={settings.deviceName}
              onChange={(e) =>
                settings.setSync({ deviceName: e.target.value })
              }
            />
          </label>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => void handleConnect()}
              disabled={busy || !settings.token || !settings.owner || !settings.repo}
            >
              {busy ? '连接中…' : '连接并同步'}
            </button>
          </div>

          {status && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                status.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : status.kind === 'error'
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {status.text}
            </p>
          )}

          <details className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
              如何创建 Token 与仓库？（点开查看步骤）
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-500 dark:text-slate-400">
              <li>
                打开{' '}
                <a
                  className="link"
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub → Settings → Fine-grained tokens
                </a>
                ，新建 Token
              </li>
              <li>
                Repository access 选 <b>Only select repositories</b>，把{' '}
                <b>reader-data</b> 加进去（点「创建数据仓库」之前仓库还不存在时，可先临时选
                All repositories，建好后再改回来）；权限需要：
                <b> Contents → Read and write</b>（自动创建仓库还需
                Administration → Read and write）
              </li>
              <li>
                复制 Token 填到上面，用户名填你的 GitHub 用户名，仓库名保持{' '}
                <b>reader-data</b>
              </li>
              <li>
                点「连接并同步」。在其他设备打开应用的{' '}
                <b>线上地址</b>，填同一个 Token，打开页面后会自动把书拉下来
              </li>
            </ol>
            <p className="mt-2 text-xs text-slate-400">
              Token 只保存在本浏览器的 localStorage，不会发给除 GitHub
              以外的任何服务。
            </p>
          </details>
        </section>

        {/* 阅读偏好 */}
        <section className="card">
          <h2 className="card-title">📖 阅读偏好</h2>
          <label className="field">
            <span>主题</span>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm ${
                    settings.theme === t
                      ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                  }`}
                  onClick={() => settings.setTheme(t)}
                >
                  {t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            <span>默认字号：{settings.fontSize}px</span>
            <input
              type="range"
              min={12}
              max={28}
              step={1}
              value={settings.fontSize}
              onChange={(e) =>
                settings.setReader({ fontSize: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>
          <label className="field">
            <span>行距：{settings.lineHeight.toFixed(1)}</span>
            <input
              type="range"
              min={1.2}
              max={2.6}
              step={0.1}
              value={settings.lineHeight}
              onChange={(e) =>
                settings.setReader({ lineHeight: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>
          <label className="field">
            <span>页边距：{settings.margin}px</span>
            <input
              type="range"
              min={0}
              max={48}
              step={2}
              value={settings.margin}
              onChange={(e) =>
                settings.setReader({ margin: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={settings.serif}
              onChange={(e) => settings.setReader({ serif: e.target.checked })}
            />
            衬线字体（宋体风格，适合长文）
          </label>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={settings.indent}
              onChange={(e) => settings.setReader({ indent: e.target.checked })}
            />
            中文首行缩进
          </label>
          <label className="field mt-3">
            <span>EPUB 翻页方式</span>
            <div className="flex gap-2">
              {(['paginated', 'scrolled'] as const).map((flow) => (
                <button
                  key={flow}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm ${
                    settings.epubFlow === flow
                      ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                  }`}
                  onClick={() => settings.setReader({ epubFlow: flow })}
                >
                  {flow === 'paginated' ? '分页' : '滚动'}
                </button>
              ))}
            </div>
          </label>
        </section>

        <StorageSection />

        <footer className="pb-8 text-center text-xs text-slate-400">
          DailyReader · 数据在你自己的 GitHub 仓库 · AGPL 之外的自研实现
          <br />
          版本 <code className="text-slate-500">{__APP_VERSION__}</code>
          （如需排障请提供此号）
        </footer>
      </main>
    </div>
  );
}

function StorageSection() {
  const [info, setInfo] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  useEffect(() => {
    void storageUsage().then(setInfo);
  }, []);
  return (
    <section className="card">
      <h2 className="card-title">💾 本地存储</h2>
      <p className="card-desc">
        {info && info.quota
          ? `已用 ${fmtBytes(info.usage)} / 配额 ${fmtBytes(info.quota)}。书籍文件缓存在 IndexedDB，离线也能读。`
          : '书籍文件缓存在浏览器 IndexedDB 中，离线也能继续阅读。'}
      </p>
    </section>
  );
}
