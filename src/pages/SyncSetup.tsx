import { useEffect, useState } from 'react';
import { useSettings } from '../store/useSettings';
import { connectAndSync, suggestOwner } from '../sync/connect';
import type { SyncDetail } from '../sync/orchestrator';

export function SyncSetup({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (ok: boolean, message: string) => void;
}) {
  const settings = useSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!useSettings.getState().owner) {
      const owner = suggestOwner();
      if (owner) useSettings.getState().setSync({ owner });
    }
  }, []);

  async function handleConnect() {
    setBusy(true);
    setStatus('正在连接…');
    const result = await connectAndSync((stage: string, _detail?: SyncDetail) =>
      setStatus(stage),
    );
    setBusy(false);
    setStatus(result.message);
    if (result.ok) onDone(true, result.message);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-slate-800 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          连接书架，手机和电脑才能看到同一批书
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          这个网页只负责打开阅读器。书存在每台浏览器自己的本地库里，所以换一台设备会是空的。连上你自己的
          GitHub 私有仓库后，打开网页就会自动同步。
        </p>

        <ol className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <li>
            <b>1. 创建 Token。</b> 打开{' '}
            <a
              className="link"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Fine-grained token
            </a>
            。仓库先选 All repositories（数据仓库还没建出来），权限勾选 Contents 读写，以及
            Administration 读写（用来自动创建私有仓库）。生成后复制。
          </li>
          <li>
            <b>2. 填写下面三项。</b> 用户名是 GitHub 用户名，仓库名保持{' '}
            <b>reader-data</b>，不要填代码仓库 DailyReader。
          </li>
          <li>
            <b>3. 点「连接并同步」。</b> 会测试连接、创建数据仓库，并把这台设备上的书传上去。另一台设备打开同一网址，粘贴同一个
            Token，书就会出现。
          </li>
        </ol>

        <label className="field mt-4">
          <span>Personal Access Token</span>
          <input
            type="password"
            value={settings.token}
            placeholder="github_pat_…"
            autoComplete="off"
            onChange={(e) => settings.setSync({ token: e.target.value.trim() })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>用户名</span>
            <input
              value={settings.owner}
              placeholder="your-github-username"
              onChange={(e) => settings.setSync({ owner: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>数据仓库</span>
            <input
              value={settings.repo}
              placeholder="reader-data"
              onChange={(e) => settings.setSync({ repo: e.target.value.trim() })}
            />
          </label>
        </div>

        {status && (
          <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {status}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            稍后再说
          </button>
          <button
            className="btn-primary"
            disabled={busy || !settings.token || !settings.owner || !settings.repo}
            onClick={() => void handleConnect()}
          >
            {busy ? '连接中…' : '连接并同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
